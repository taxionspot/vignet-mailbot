// Getypeerde client voor de drie bot-endpoints in de app (spec sectie 7.2):
//
//   GET  /api/bot/order   feitenset ophalen
//   POST /api/bot/actie   annuleer_refund, resend_bevestiging, resend_bewijs
//   POST /api/bot/log     een MailBotLog-regel wegschrijven
//
// Elke aanroep stuurt Authorization: Bearer <BOT_SECRET>. De bot heeft
// bewust GEEN admin-rechten.
//
// De kern is het onderscheid dat de spec eist: een 4xx is DEFINITIEF (het
// verzoek is geweigerd, niet opnieuw proberen), een time-out of 5xx is
// ONBEKEND (mag opnieuw, maar NOOIT bij een geldactie). Dat verschil zit in
// het veld `soort` van ApiFout en in het veld `definitief` van ActieResultaat.

import { config } from "./config.js";
import { log } from "./log.js";
import type {
  ActieOpdracht,
  ActieResultaat,
  BotOrderAntwoord,
  MailBotLogRegel,
  OrderZoek,
  UitvoerActie,
} from "./types.js";

// ---------------------------------------------------------------------------
// Foutmodel
// ---------------------------------------------------------------------------

/**
 * geweigerd = de app zei nee met een 4xx. Definitief, niet opnieuw proberen.
 * onbekend  = time-out, netwerkfout of 5xx. De uitkomst staat niet vast.
 */
export type ApiFoutSoort = "geweigerd" | "onbekend";

export class ApiFout extends Error {
  readonly soort: ApiFoutSoort;
  readonly httpStatus?: number;
  readonly foutcode?: string;

  constructor(soort: ApiFoutSoort, bericht: string, opts?: { httpStatus?: number; foutcode?: string }) {
    super(bericht);
    this.name = "ApiFout";
    this.soort = soort;
    this.httpStatus = opts?.httpStatus;
    this.foutcode = opts?.foutcode;
  }
}

// ---------------------------------------------------------------------------
// Interne fetch-helper met time-out en foutclassificatie
// ---------------------------------------------------------------------------

interface HttpAntwoord<T> {
  status: number;
  body: T;
}

// Doet een HTTP-verzoek en vertaalt alles naar ofwel een HttpAntwoord met de
// geparseerde body, ofwel een ApiFout van de juiste soort. Parsefouten en
// time-outs worden hier al ingedeeld, zodat de aanroeper alleen nog op `soort`
// hoeft te kijken.
async function doeVerzoek<T>(
  methode: "GET" | "POST",
  pad: string,
  opts: { body?: unknown; timeoutMs: number }
): Promise<HttpAntwoord<T>> {
  const url = `${config.app.basisUrl}${pad}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.app.botSecret}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: methode,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      // AbortSignal.timeout gooit een TimeoutError (een DOMException) na afloop.
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    // Time-out of netwerkfout: de uitkomst staat niet vast.
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const reden = isTimeout ? `time-out na ${opts.timeoutMs}ms` : "netwerkfout";
    throw new ApiFout("onbekend", `${methode} ${pad}: ${reden}`, {
      foutcode: isTimeout ? "timeout" : "netwerk",
    });
  }

  // 5xx: server heeft een probleem, uitkomst onbekend, mag opnieuw.
  if (res.status >= 500) {
    // Body leegtrekken zodat de socket vrijkomt, inhoud interesseert ons niet.
    await res.text().catch(() => "");
    throw new ApiFout("onbekend", `${methode} ${pad}: server ${res.status}`, {
      httpStatus: res.status,
      foutcode: `http_${res.status}`,
    });
  }

  // Body parsen. Zowel 2xx als 4xx horen JSON terug te geven.
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    // Geen geldige JSON. Bij 4xx is dat definitief geweigerd, bij 2xx een defect
    // dat we ook als onbekend behandelen (we weten niet of de actie liep).
    if (res.status >= 400) {
      throw new ApiFout("geweigerd", `${methode} ${pad}: ${res.status} zonder geldige JSON`, {
        httpStatus: res.status,
      });
    }
    throw new ApiFout("onbekend", `${methode} ${pad}: ${res.status} maar onleesbare JSON`, {
      httpStatus: res.status,
    });
  }

  // 4xx: definitief geweigerd. De foutcode zit meestal in body.error.
  if (res.status >= 400) {
    const foutcode = typeof (body as { error?: unknown })?.error === "string"
      ? ((body as { error: string }).error)
      : undefined;
    throw new ApiFout("geweigerd", `${methode} ${pad}: ${res.status}${foutcode ? ` (${foutcode})` : ""}`, {
      httpStatus: res.status,
      foutcode,
    });
  }

  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// GET /api/bot/order
// ---------------------------------------------------------------------------

/**
 * Haalt de feitenset op. Gooit ApiFout bij een netwerk- of serverfout. Een
 * order die niet bestaat is GEEN fout: dan komt {ok:false} of {ok:true,
 * order:undefined} terug en dat geven we door.
 */
export async function haalOrder(zoek: OrderZoek): Promise<BotOrderAntwoord> {
  const params = new URLSearchParams();
  if (zoek.soort === "token") params.set("token", zoek.token);
  else if (zoek.soort === "email") params.set("email", zoek.email);
  else params.set("plaat", zoek.plaat);

  try {
    const { body } = await doeVerzoek<BotOrderAntwoord>("GET", `/api/bot/order?${params.toString()}`, {
      timeoutMs: config.app.httpTimeoutMs,
    });
    return body;
  } catch (err) {
    if (err instanceof ApiFout && err.soort === "geweigerd" && err.httpStatus === 404) {
      // 404 op een zoekvraag = niet gevonden, geen echte fout.
      return { ok: false, error: "niet_gevonden" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/bot/actie
// ---------------------------------------------------------------------------

/**
 * Voert een actie uit die de app kent: annuleer_refund, resend_bevestiging of
 * resend_bewijs. Antwoord en escalatie lopen NIET hier (die stuurt de bot zelf
 * of via een aparte verzendweg), dus die worden geweigerd.
 *
 * KRITIEK voor de geldactie: bij een ApiFout van soort "onbekend" (time-out of
 * 5xx) mag annuleer_refund NOOIT opnieuw. Dat is de reden dat we hier
 * `definitief: false` teruggeven en de fout niet doorgooien: de lus escaleert
 * dan naar Sabur in plaats van blind te herhalen.
 */
export async function stuurActie(opdracht: ActieOpdracht): Promise<ActieResultaat> {
  const uitvoerActies: UitvoerActie[] = ["annuleer_refund", "resend_bevestiging", "resend_bewijs"];
  if (!(uitvoerActies as string[]).includes(opdracht.actie)) {
    // antwoord_sturen en escalatie_sturen horen niet via /api/bot/actie.
    return {
      ok: false,
      actie: opdracht.actie as UitvoerActie,
      uitgevoerd: false,
      definitief: true,
      fout: "actie_niet_via_deze_route",
    };
  }

  const isRefund = opdracht.actie === "annuleer_refund";
  const timeoutMs = isRefund ? config.app.httpTimeoutRefundMs : config.app.httpTimeoutMs;

  try {
    const { body } = await doeVerzoek<ActieResultaat>("POST", "/api/bot/actie", {
      body: opdracht,
      timeoutMs,
    });
    return body;
  } catch (err) {
    if (err instanceof ApiFout) {
      if (err.soort === "geweigerd") {
        // Definitief nee van de app. Veilig: er is niets gebeurd.
        return {
          ok: false,
          actie: opdracht.actie,
          uitgevoerd: false,
          definitief: true,
          fout: err.foutcode ?? "geweigerd",
        };
      }
      // Onbekend. Bij een geldactie NOOIT opnieuw, dus als niet-definitief terug.
      log.warn(`Actie ${opdracht.actie} onbekende uitkomst`, err);
      return {
        ok: false,
        actie: opdracht.actie,
        uitgevoerd: false,
        definitief: false,
        fout: err.foutcode ?? "onbekend",
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/bot/log
// ---------------------------------------------------------------------------

/**
 * Schrijft een logregel weg. Best effort: een mislukte log mag de verwerking
 * van de mail niet stilleggen, dus deze functie gooit nooit. Bij mislukken
 * logt hij lokaal en geeft false terug.
 */
export async function schrijfLog(regel: MailBotLogRegel): Promise<boolean> {
  try {
    await doeVerzoek<{ ok: boolean }>("POST", "/api/bot/log", {
      body: regel,
      timeoutMs: config.app.httpTimeoutMs,
    });
    return true;
  } catch (err) {
    log.warn(`Logregel wegschrijven mislukt voor ${regel.botMailId}`, err);
    return false;
  }
}
