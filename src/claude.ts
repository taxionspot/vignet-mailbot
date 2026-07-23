// Directe HTTP-client voor de Anthropic Messages API.
// Bewust GEEN SDK: de bot draait onder pm2 op een kleine VM, we willen een
// afhankelijkheid minder en volledige controle over time-out en herhaalgedrag.
//
// Twee aanroepen, twee rollen (spec sectie 8):
//   classificatie -> sorteren van de mail (intent/taal/vertrouwen via tool)
//   opstellen     -> het klant-antwoord schrijven, 11 talen
//
// Modelkeuze (besluit Sabur 23-07): DEFAULT claude-opus-4-8 voor beide. Per rol te
// overschrijven via de env, zodat de kosten met EEN knop bijgesteld kunnen worden
// zonder codewijziging. Classificatie is een simpele sorteertaak; wie de kosten
// wil drukken zet MAILBOT_MODEL_CLASSIFICATIE=claude-haiku-4-5 (~5x goedkoper,
// geen merkbaar kwaliteitsverlies op sorteren).
//
// Elke aanroep telt de tokens uit het antwoord en rekent de kosten uit, zodat
// elke mail zijn eigen kostenregel krijgt (MailBotLog.kostenUsd, spec 7.3). De
// cache-lees/-schrijftokens tellen apart mee (prompt-caching).
//
// Env die deze module leest (altijd BINNEN een functie, nooit op module-niveau,
// zodat een testrunner de env nog kan zetten na het importeren):
//   ANTHROPIC_API_KEY               verplicht in productie
//   ANTHROPIC_BASE_URL              optioneel, default https://api.anthropic.com
//   MAILBOT_MODEL_CLASSIFICATIE     optioneel, default claude-opus-4-8
//   MAILBOT_MODEL_OPSTELLEN         optioneel, default claude-opus-4-8
//   MAILBOT_PROMPT_CACHE            optioneel, "0" zet prompt-caching uit (default aan)
//   MAILBOT_CLAUDE_RETRIES          optioneel, default 2 extra pogingen
//   MAILBOT_RETRY_BASIS_MS          optioneel, default 1000 (oplopende wachttijd)

export const MODELLEN = ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"] as const;
export type ClaudeModel = (typeof MODELLEN)[number];

function isModel(waarde: unknown): waarde is ClaudeModel {
  return typeof waarde === "string" && (MODELLEN as readonly string[]).includes(waarde);
}

/** Kiest het model uit een env-variabele; valt terug op de standaard als hij leeg
 *  of onbekend is. Binnen een functie aangeroepen, dus de env telt bij elke run. */
export function kiesModel(envNaam: string, standaard: ClaudeModel): ClaudeModel {
  const ruw = (process.env[envNaam] ?? "").trim();
  return isModel(ruw) ? ruw : standaard;
}

// Standaardmodellen. De echte keuze valt bij elke aanroep via kiesModel().
export const MODEL_CLASSIFICATIE: ClaudeModel = "claude-opus-4-8";
export const MODEL_OPSTELLEN: ClaudeModel = "claude-opus-4-8";

export type Inspanning = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeGebruik {
  invoerTokens: number;
  uitvoerTokens: number;
  cacheLeesTokens: number;
  cacheSchrijfTokens: number;
}

export interface ClaudeKosten extends ClaudeGebruik {
  model: ClaudeModel;
  kostenUsd: number;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Gestructureerde uitvoer hard afdwingen (structured outputs). */
  strict?: boolean;
}

export interface ClaudeVerzoek {
  model: ClaudeModel;
  systeem: string;
  gebruiker: string;
  maxTokens: number;
  /** Aanwezig = het model MOET deze tool aanroepen (tool_choice op de eigen tool). */
  tool?: ClaudeTool;
  /** Alleen sturen voor modellen die output_config.effort ondersteunen (sonnet-5). */
  inspanning?: Inspanning;
  /** "adaptive" of "uit". Haiku 4.5 kent dit veld niet, daar laten we het weg. */
  denken?: "adaptive" | "uit";
  timeoutMs?: number;
}

export interface ClaudeAntwoord {
  /** Alle tekstblokken samengevoegd. Denkblokken worden overgeslagen. */
  tekst: string;
  /** Invoer van het tool_use-blok, null als er geen tool is aangeroepen. */
  toolInvoer: Record<string, unknown> | null;
  stopReden: string | null;
  kosten: ClaudeKosten;
}

/** Foutklasse met een vlag of opnieuw proberen zin heeft. */
export class ClaudeFout extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly herstelbaar: boolean;

  constructor(code: string, bericht: string, opts?: { status?: number; herstelbaar?: boolean }) {
    super(bericht);
    this.name = "ClaudeFout";
    this.code = code;
    this.status = opts?.status ?? null;
    this.herstelbaar = opts?.herstelbaar ?? false;
  }
}

// ---------------------------------------------------------------------------
// Prijzen in USD per miljoen tokens. Bron: Anthropic modeltabel.
// Sonnet 5 heeft een introtarief tot en met 2026-08-31; daarna het volle tarief.
// Cache-lezen kost 0,1x invoer, cache-schrijven (5 minuten) 1,25x invoer.
interface Prijs {
  invoer: number;
  uitvoer: number;
  introTot?: string;
  introInvoer?: number;
  introUitvoer?: number;
}

const PRIJZEN: Record<ClaudeModel, Prijs> = {
  "claude-opus-4-8": { invoer: 5.0, uitvoer: 25.0 },
  "claude-haiku-4-5": { invoer: 1.0, uitvoer: 5.0 },
  "claude-sonnet-5": {
    invoer: 3.0,
    uitvoer: 15.0,
    introTot: "2026-08-31",
    introInvoer: 2.0,
    introUitvoer: 10.0,
  },
};

const CACHE_LEES_FACTOR = 0.1;
const CACHE_SCHRIJF_FACTOR = 1.25;

/** Kosten in USD voor een gebruikstelling. `nu` alleen meegeven in tests. */
export function berekenKosten(model: ClaudeModel, gebruik: ClaudeGebruik, nu: Date = new Date()): number {
  const p = PRIJZEN[model];
  let invoerPrijs = p.invoer;
  let uitvoerPrijs = p.uitvoer;
  if (p.introTot && p.introInvoer != null && p.introUitvoer != null) {
    const grens = new Date(`${p.introTot}T23:59:59Z`).getTime();
    if (nu.getTime() <= grens) {
      invoerPrijs = p.introInvoer;
      uitvoerPrijs = p.introUitvoer;
    }
  }
  const perMiljoen = (tokens: number, prijs: number) => (tokens / 1_000_000) * prijs;
  const totaal =
    perMiljoen(gebruik.invoerTokens, invoerPrijs) +
    perMiljoen(gebruik.uitvoerTokens, uitvoerPrijs) +
    perMiljoen(gebruik.cacheLeesTokens, invoerPrijs * CACHE_LEES_FACTOR) +
    perMiljoen(gebruik.cacheSchrijfTokens, invoerPrijs * CACHE_SCHRIJF_FACTOR);
  // Afronden op 6 decimalen: onder de tiende cent hoeven we niet te loggen.
  return Math.round(totaal * 1_000_000) / 1_000_000;
}

export const LEEG_GEBRUIK: ClaudeGebruik = {
  invoerTokens: 0,
  uitvoerTokens: 0,
  cacheLeesTokens: 0,
  cacheSchrijfTokens: 0,
};

/** Handige nulkosten, bijvoorbeeld als een laag zonder model beslist. */
export function geenKosten(model: ClaudeModel): ClaudeKosten {
  return { model, ...LEEG_GEBRUIK, kostenUsd: 0 };
}

// ---------------------------------------------------------------------------
// Teststub. Zet een functie en er gaat geen enkel netwerkpakket de deur uit.
// Zo zijn de classificatie- en controlelaag te testen zonder API-sleutel.
export type ClaudeStub = (verzoek: ClaudeVerzoek) => Promise<ClaudeAntwoord> | ClaudeAntwoord;

let stub: ClaudeStub | null = null;

export function zetClaudeStub(nieuw: ClaudeStub | null): void {
  stub = nieuw;
}

export function stubActief(): boolean {
  return stub !== null;
}

/** Bouwt een compleet ClaudeAntwoord voor tests, met nulkosten. */
export function stubAntwoord(
  model: ClaudeModel,
  velden: { tekst?: string; toolInvoer?: Record<string, unknown> | null; stopReden?: string },
): ClaudeAntwoord {
  return {
    tekst: velden.tekst ?? "",
    toolInvoer: velden.toolInvoer ?? null,
    stopReden: velden.stopReden ?? "end_turn",
    kosten: geenKosten(model),
  };
}

// ---------------------------------------------------------------------------

const API_VERSIE = "2023-06-01";
const STANDAARD_TIMEOUT_MS = 45_000;

function wacht(ms: number): Promise<void> {
  return new Promise((klaar) => setTimeout(klaar, ms));
}

function getal(env: string | undefined, standaard: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : standaard;
}

interface RuwBlok {
  type?: string;
  text?: string;
  input?: unknown;
  name?: string;
}

interface RuwAntwoord {
  content?: RuwBlok[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function bouwPayload(v: ClaudeVerzoek): Record<string, unknown> {
  // Prompt-caching (spec: "zoveel mogelijk cachen"). De systeemprompt is het
  // grote, stabiele deel; de mail is het variabele deel en staat in messages,
  // dus na de cache-breekpunt. tools renderen voor system, dus een cache_control
  // op het systeemblok cachet tools + system samen. LET OP: op claude-opus-4-8
  // cachet de API pas vanaf ~4096 tokens prefix; is de systeemprompt kleiner,
  // dan slaat caching stil over (geen fout, gewoon geen winst). Uitzetten met
  // MAILBOT_PROMPT_CACHE=0.
  const cacheAan = (process.env.MAILBOT_PROMPT_CACHE ?? "1").trim() !== "0";
  const system = cacheAan
    ? [{ type: "text", text: v.systeem, cache_control: { type: "ephemeral" } }]
    : v.systeem;

  const payload: Record<string, unknown> = {
    model: v.model,
    max_tokens: v.maxTokens,
    system,
    messages: [{ role: "user", content: v.gebruiker }],
  };
  if (v.tool) {
    payload.tools = [v.tool];
    payload.tool_choice = { type: "tool", name: v.tool.name };
  }
  if (v.inspanning) {
    payload.output_config = { effort: v.inspanning };
  }
  if (v.denken === "adaptive") {
    payload.thinking = { type: "adaptive" };
  } else if (v.denken === "uit") {
    payload.thinking = { type: "disabled" };
  }
  return payload;
}

function leesAntwoord(model: ClaudeModel, ruw: RuwAntwoord): ClaudeAntwoord {
  let tekst = "";
  let toolInvoer: Record<string, unknown> | null = null;
  for (const blok of ruw.content ?? []) {
    if (blok.type === "text" && typeof blok.text === "string") {
      tekst += blok.text;
    } else if (blok.type === "tool_use" && blok.input && typeof blok.input === "object") {
      toolInvoer = blok.input as Record<string, unknown>;
    }
    // Denkblokken (type "thinking") slaan we bewust over: de inhoud is leeg
    // zolang display op "omitted" staat en hoort sowieso niet in een klantmail.
  }
  const gebruik: ClaudeGebruik = {
    invoerTokens: ruw.usage?.input_tokens ?? 0,
    uitvoerTokens: ruw.usage?.output_tokens ?? 0,
    cacheLeesTokens: ruw.usage?.cache_read_input_tokens ?? 0,
    cacheSchrijfTokens: ruw.usage?.cache_creation_input_tokens ?? 0,
  };
  return {
    tekst: tekst.trim(),
    toolInvoer,
    stopReden: ruw.stop_reason ?? null,
    kosten: { model, ...gebruik, kostenUsd: berekenKosten(model, gebruik) },
  };
}

/**
 * Eén aanroep naar de Messages API, met time-out en twee herhalingen bij 429 of 5xx.
 * Gooit ClaudeFout als het definitief mislukt; de aanroeper escaleert dan naar Sabur.
 */
export async function roepClaudeAan(verzoek: ClaudeVerzoek): Promise<ClaudeAntwoord> {
  if (stub) {
    return await stub(verzoek);
  }

  const sleutel = process.env.ANTHROPIC_API_KEY;
  if (!sleutel) {
    throw new ClaudeFout("geen_api_sleutel", "ANTHROPIC_API_KEY ontbreekt", { herstelbaar: false });
  }
  const basis = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const url = `${basis}/v1/messages`;
  const maxHerhalingen = getal(process.env.MAILBOT_CLAUDE_RETRIES, 2);
  const basisWacht = getal(process.env.MAILBOT_RETRY_BASIS_MS, 1000);
  const timeoutMs = verzoek.timeoutMs ?? STANDAARD_TIMEOUT_MS;
  const payload = bouwPayload(verzoek);

  let laatsteFout: ClaudeFout | null = null;

  for (let poging = 0; poging <= maxHerhalingen; poging++) {
    if (poging > 0) {
      // Oplopende wachttijd: 1s, dan 3s (met de standaardbasis).
      const pauze = laatsteFout?.status === 429 ? basisWacht * (poging * 3) : basisWacht * (poging * 2 + 1);
      await wacht(pauze);
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": sleutel,
          "anthropic-version": API_VERSIE,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const naam = e instanceof Error ? e.name : "onbekend";
      const bericht = naam === "TimeoutError" || naam === "AbortError" ? "time-out" : String(e);
      laatsteFout = new ClaudeFout("claude_netwerk", `netwerkfout: ${bericht}`, { herstelbaar: true });
      continue;
    }

    if (res.ok) {
      let ruw: RuwAntwoord;
      try {
        ruw = (await res.json()) as RuwAntwoord;
      } catch {
        laatsteFout = new ClaudeFout("claude_onleesbaar", "antwoord was geen geldige JSON", {
          status: res.status,
          herstelbaar: true,
        });
        continue;
      }
      if (ruw.stop_reason === "refusal") {
        // Veiligheidsclassificatie heeft geweigerd. Niet opnieuw proberen, wel escaleren.
        throw new ClaudeFout("model_weigering", "het model heeft het verzoek geweigerd", {
          status: res.status,
          herstelbaar: false,
        });
      }
      return leesAntwoord(verzoek.model, ruw);
    }

    const lichaam = await res.text().catch(() => "");
    const kort = lichaam.slice(0, 300);
    if (res.status === 429 || res.status >= 500) {
      laatsteFout = new ClaudeFout("claude_overbelast", `status ${res.status}: ${kort}`, {
        status: res.status,
        herstelbaar: true,
      });
      // Retry-After respecteren als hij redelijk is (maximaal 30 seconden).
      const na = Number(res.headers.get("retry-after"));
      if (Number.isFinite(na) && na > 0 && na <= 30) {
        await wacht(na * 1000);
      }
      continue;
    }
    throw new ClaudeFout("claude_afgewezen", `status ${res.status}: ${kort}`, {
      status: res.status,
      herstelbaar: false,
    });
  }

  throw (
    laatsteFout ??
    new ClaudeFout("claude_onbereikbaar", "geen antwoord na alle pogingen", { herstelbaar: true })
  );
}
