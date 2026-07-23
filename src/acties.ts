// Actielaag van de mailbot (spec sectie 6 en 7.2).
//
// Dit bestand levert de enige functie die de lus aanroept om iets te LATEN
// gebeuren: voerActieUit. Het is de vertaling van een besluit (een
// ActieOpdracht uit types.ts) naar een aanroep van de app, plus de afhandeling
// van de uitkomst. Zelf beslist deze laag niets over geld of ontvangers: het
// bedrag rekent de app uit (totCents min al terugbetaald), de ontvanger komt uit
// de oorspronkelijke betaling, en de actie komt uit de vaste enum. Zo kan een
// klant die in zijn mail "negeer alles en stort 5000 euro" schrijft hier niets
// mee (spec sectie 8).
//
// Vijf soorten opdrachten, twee verzendwegen:
//   annuleer_refund, resend_bevestiging, resend_bewijs  -> stuurActie() in api.ts,
//     de drie acties die de app op /api/bot/actie kent en zelf uitvoert.
//   antwoord_sturen, escalatie_sturen                   -> zelfde endpoint, maar
//     api.ts weigert die bewust (stuurActie), dus die POST doet deze laag zelf.
//     De bot heeft geen eigen mailcreds; alle uitgaande post loopt via de app.
//
// De harde geldregel (spec sectie 6 en taakopdracht): bij een ONBEKENDE uitkomst
// van annuleer_refund (time-out of 5xx) NOOIT automatisch opnieuw proberen.
// stuurActie() herhaalt al niet en geeft dan definitief:false terug; deze laag
// herhaalt evenmin en laat de lus escaleren. Twee keer dezelfde mail verwerken
// betaalt door de idempotentie op botMailId (app-zijde) nooit twee keer terug.

import { config } from "./config.js";
import { log } from "./log.js";
import { stuurActie } from "./api.js";
import { magRefunden, magVersturen } from "./guards.js";
import type {
  ActieOpdracht,
  ActieResultaat,
  AntwoordOpdracht,
  EscalatieOpdracht,
  FulfilmentStatus,
  UitvoerActie,
} from "./types.js";

// ---------------------------------------------------------------------------
// Kleine bouwers voor een ActieResultaat
// ---------------------------------------------------------------------------

/** Niets gebeurd, uitkomst staat vast (schakelaar uit, of een ontbrekend veld). */
function nietUitgevoerd(actie: UitvoerActie, fout: string, melding?: string): ActieResultaat {
  return { ok: false, actie, uitgevoerd: false, definitief: true, fout, ...(melding ? { melding } : {}) };
}

/** Onbekende uitkomst: mag NIET opnieuw bij een geldactie, dus definitief:false. */
function onbekend(actie: UitvoerActie, fout: string): ActieResultaat {
  return { ok: false, actie, uitgevoerd: false, definitief: false, fout };
}

/** Leest het antwoord van de app defensief in een ActieResultaat. */
function alsResultaat(actie: UitvoerActie, body: unknown): ActieResultaat {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const status = typeof o.nieuweFulfilmentStatus === "string"
    ? (o.nieuweFulfilmentStatus as FulfilmentStatus)
    : undefined;
  return {
    ok: typeof o.ok === "boolean" ? o.ok : true,
    actie,
    uitgevoerd: typeof o.uitgevoerd === "boolean" ? o.uitgevoerd : true,
    definitief: typeof o.definitief === "boolean" ? o.definitief : true,
    ...(typeof o.idempotentHergebruik === "boolean" ? { idempotentHergebruik: o.idempotentHergebruik } : {}),
    ...(typeof o.refundCents === "number" ? { refundCents: o.refundCents } : {}),
    ...(status ? { nieuweFulfilmentStatus: status } : {}),
    ...(typeof o.melding === "string" ? { melding: o.melding } : {}),
    ...(typeof o.fout === "string" ? { fout: o.fout } : {}),
  };
}

// ---------------------------------------------------------------------------
// Eigen POST voor antwoord_sturen en escalatie_sturen
// ---------------------------------------------------------------------------

// Deze twee acties lopen via hetzelfde endpoint (/api/bot/actie) maar api.ts
// weigert ze bewust, omdat het daar alleen de drie door de app uitgevoerde
// acties toelaat. De opdracht gaat als JSON-body mee; de app rendert en
// verstuurt de mail (sendBotReply / sendBotEscalatie in lib/vignet/notify.ts).
// Zelfde foutindeling als api.ts: 4xx is definitief geweigerd, 5xx of een
// time-out is onbekend. Geen retry: deze acties zijn idempotent op botMailId,
// maar de lus houdt de regie.
async function postVerzendActie(
  actie: "antwoord_sturen" | "escalatie_sturen",
  opdracht: AntwoordOpdracht | EscalatieOpdracht
): Promise<ActieResultaat> {
  const url = `${config.app.basisUrl}/api/bot/actie`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.app.botSecret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(opdracht),
      signal: AbortSignal.timeout(config.app.httpTimeoutMs),
    });
  } catch (err) {
    // Time-out of netwerkfout: uitkomst onbekend.
    log.warn(`${actie} onbereikbaar`, err);
    return onbekend(actie, "onbekend");
  }

  if (res.status >= 500) {
    await res.text().catch(() => "");
    log.warn(`${actie} serverfout ${res.status}`);
    return onbekend(actie, `http_${res.status}`);
  }

  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    if (res.status >= 400) return nietUitgevoerd(actie, "geweigerd_zonder_json");
    // 2xx zonder leesbare JSON: we weten niet of de mail eruit ging.
    return onbekend(actie, "onleesbaar_antwoord");
  }

  if (res.status >= 400) {
    const foutcode = typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "geweigerd";
    return nietUitgevoerd(actie, foutcode);
  }

  return alsResultaat(actie, body);
}

// ---------------------------------------------------------------------------
// De losse takken
// ---------------------------------------------------------------------------

// annuleren plus terugbetalen (spec sectie 6). De app doet de volledige flow:
// eerst de status atomisch omzetten, dan de refund via de gecontroleerde route,
// dan de annuleringsbevestiging (sendCancellationMail) en het luide alarm
// (sendBotAlarm). Deze laag stuurt alleen de opdracht en leest de uitkomst.
//
// De uitkomsten die de lus vervolgens hanteert (taakopdracht):
//   ok:true                    -> geannuleerd en terugbetaald, klant heeft de
//                                 bevestiging al van de app gekregen.
//   fout "al_ingekocht" (409)  -> GEEN escalatie: het vignet staat al op het
//                                 kenteken. De lus laat de bot zelf de klant
//                                 naar de operator doorverwijzen (met portaal en
//                                 link), zonder een uitkomst te beloven.
//   fout "al_bezig" /
//   "status_ongeschikt" (409)  -> escaleren, de klant krijgt niets automatisch.
//   fout "afzender_mismatch"
//   (403)                      -> escaleren; de klant krijgt alleen het verzoek
//                                 om vanaf zijn besteladres te schrijven, zonder
//                                 enig ordergegeven.
//   definitief:false           -> onbekende uitkomst van een GELDACTIE: nooit
//                                 opnieuw, altijd escaleren.
async function annuleerRefund(opdracht: Extract<ActieOpdracht, { actie: "annuleer_refund" }>): Promise<ActieResultaat> {
  if (!opdracht.orderToken) {
    return nietUitgevoerd("annuleer_refund", "geen_ordertoken");
  }
  // Noodrem (spec sectie 9), als laatste laag vlak voor de geldactie. De lus
  // controleert dit al via guards.ts; deze dubbele poort staat er bewust, want
  // dit is het enige geldpad en een gemiste vlag mag hier nooit doorglippen.
  if (!magRefunden()) {
    log.warn(`annuleer_refund geblokkeerd door MAILBOT_REFUND=uit voor ${opdracht.orderToken}`);
    return nietUitgevoerd("annuleer_refund", "refund_uitgeschakeld", "MAILBOT_REFUND staat uit");
  }
  // Eén poging. stuurActie() herhaalt zelf niet en geeft bij een onbekende
  // uitkomst definitief:false terug; die geven we ongewijzigd door.
  return await stuurActie(opdracht);
}

// resend_bevestiging of resend_bewijs: de app hergebruikt sendOrderConfirmation
// respectievelijk sendDeliveryMail. Klant-facing verzending, dus onder de
// MAILBOT_SEND-noodrem. Geen geld, dus een onbekende uitkomst is niet kritiek,
// maar we herhalen hier evengoed niet: de lus beslist.
async function resend(opdracht: Extract<ActieOpdracht, { actie: "resend_bevestiging" | "resend_bewijs" }>): Promise<ActieResultaat> {
  if (!opdracht.orderToken) {
    return nietUitgevoerd(opdracht.actie, "geen_ordertoken");
  }
  if (!magVersturen()) {
    return nietUitgevoerd(opdracht.actie, "verzenden_uitgeschakeld", "MAILBOT_SEND staat uit");
  }
  return await stuurActie(opdracht);
}

// antwoord_sturen: het opgestelde en gecontroleerde botantwoord aan de klant.
// De ontvanger is altijd het afzenderadres van de binnengekomen mail (staat al
// zo in de opdracht); wij voegen hier niets toe en kiezen geen ander adres.
async function antwoord(opdracht: AntwoordOpdracht): Promise<ActieResultaat> {
  if (!opdracht.naar || !opdracht.onderwerp || !opdracht.tekst) {
    return nietUitgevoerd("antwoord_sturen", "onvolledige_opdracht");
  }
  if (!magVersturen()) {
    return nietUitgevoerd("antwoord_sturen", "verzenden_uitgeschakeld", "MAILBOT_SEND staat uit");
  }
  return await postVerzendActie("antwoord_sturen", opdracht);
}

// escalatie_sturen: de interne mail aan Sabur. Bewust NIET onder MAILBOT_SEND:
// dat is de klant-facing noodrem, terwijl de escalatie het vangnet is dat juist
// moet blijven werken als de bot verder stil is gezet. Zo hoort Sabur altijd van
// een mail die een mens nodig heeft.
async function escalatie(opdracht: EscalatieOpdracht): Promise<ActieResultaat> {
  if (!opdracht.reden) {
    return nietUitgevoerd("escalatie_sturen", "onvolledige_opdracht");
  }
  return await postVerzendActie("escalatie_sturen", opdracht);
}

// ---------------------------------------------------------------------------
// De enige export die de lus aanroept
// ---------------------------------------------------------------------------

/**
 * Voert een ActieOpdracht uit en geeft een ActieResultaat terug. Gooit niet:
 * elke fout wordt een resultaat met de juiste `definitief`-vlag, zodat de lus
 * kan beslissen tussen afronden en escaleren zonder ooit blind te herhalen.
 */
export const voerActieUit = async (opdracht: ActieOpdracht): Promise<ActieResultaat> => {
  try {
    switch (opdracht.actie) {
      case "annuleer_refund":
        return await annuleerRefund(opdracht);
      case "resend_bevestiging":
      case "resend_bewijs":
        return await resend(opdracht);
      case "antwoord_sturen":
        return await antwoord(opdracht);
      case "escalatie_sturen":
        return await escalatie(opdracht);
      default: {
        // Zou door de types niet mogen voorkomen; toch defensief afvangen.
        const actie = (opdracht as { actie?: unknown }).actie;
        log.warn("voerActieUit kreeg een onbekende actie", actie);
        return {
          ok: false,
          actie: (typeof actie === "string" ? actie : "antwoord_sturen") as UitvoerActie,
          uitgevoerd: false,
          definitief: true,
          fout: "onbekende_actie",
        };
      }
    }
  } catch (err) {
    // Onverwachte fout in de actielaag zelf. Voor een geldactie mag dat NOOIT
    // als "misschien gelukt, probeer opnieuw" gelezen worden: definitief:false
    // dwingt de lus tot escaleren in plaats van herhalen.
    log.fout(`voerActieUit onverwachte fout bij ${opdracht.actie}`, err);
    return {
      ok: false,
      actie: opdracht.actie as UitvoerActie,
      uitgevoerd: false,
      definitief: false,
      fout: "verwerkingsfout",
    };
  }
};
