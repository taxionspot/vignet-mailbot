// Classificatielaag (spec sectie 8).
//
// Eerste aanroep, goedkoop model (haiku). Bepaalt intent, taal, vertrouwen en
// een samenvatting van een regel. Geen bedragen, geen adressen, geen acties.
//
// Twee harde vangnetten die de spec eist, bovenop de prompt:
//   - vertrouwen onder 0,75 wordt altijd mens_nodig,
//   - een intent die niet in de enum staat wordt altijd mens_nodig.
// Die vangnetten zitten hier in de code, niet in het model. Zo kan een
// vervormd modelantwoord de bot nooit een verkeerde autonome actie laten doen.

import {
  MODEL_CLASSIFICATIE,
  kiesModel,
  roepClaudeAan,
  geenKosten,
  type ClaudeAntwoord,
  type ClaudeKosten,
} from "./claude.js";
import {
  CLASSIFICATIE_SYSTEEM,
  CLASSIFICATIE_TOOL,
  classificatieGebruikerBlok,
  isIntent,
  isTaal,
  knipMail,
  VERTROUWEN_DREMPEL,
  type BotIntent,
  type BotTaal,
  type MailVoorClassificatie,
} from "./prompts/classificatie.js";
import { alsObject } from "./feiten.js";
import type { Classificatie, InkomendeMail } from "./types.js";

/** Concreet resultaat van de kernclassificatie, los van het gedeelde type. */
export interface ClassificatieKern {
  intent: BotIntent;
  taal: BotTaal;
  vertrouwen: number;
  samenvatting: string;
  /** True als een vangnet de intent naar mens_nodig heeft omgezet. */
  bijgestuurd: boolean;
  /** Reden van bijsturen, voor het log. Leeg als er niets bijgestuurd is. */
  bijstuurReden: string;
  kosten: ClaudeKosten;
}

const MAX_SAMENVATTING = 200;

function begrensVertrouwen(ruw: unknown): number {
  const n = typeof ruw === "number" ? ruw : Number(ruw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Leest het toolantwoord van het model en past de twee vangnetten toe. Werkt
 * puur op een ClaudeAntwoord, dus volledig testbaar met een gestubde client.
 */
export function verwerkClassificatieAntwoord(antwoord: ClaudeAntwoord): ClassificatieKern {
  const invoer = alsObject(antwoord.toolInvoer) ?? {};

  const ruweIntent = invoer.intent;
  const ruweTaal = invoer.taal;
  const vertrouwen = begrensVertrouwen(invoer.vertrouwen);
  const samenvatting =
    typeof invoer.samenvatting === "string" ? knipMail(invoer.samenvatting.trim(), MAX_SAMENVATTING) : "";

  const taal: BotTaal = isTaal(ruweTaal) ? ruweTaal : "en";

  // Vangnet 1: onbekende of ontbrekende intent wordt mens_nodig.
  let intent: BotIntent;
  let bijgestuurd = false;
  let bijstuurReden = "";
  if (!isIntent(ruweIntent)) {
    intent = "mens_nodig";
    bijgestuurd = true;
    bijstuurReden = `intent '${String(ruweIntent)}' staat niet in de enum`;
  } else {
    intent = ruweIntent;
  }

  // Vangnet 2: te laag vertrouwen wordt mens_nodig. spam_overig laten we met
  // rust; daar is niet-antwoorden juist de bedoeling en escaleren zou ruis geven.
  if (!bijgestuurd && intent !== "spam_overig" && vertrouwen < VERTROUWEN_DREMPEL) {
    intent = "mens_nodig";
    bijgestuurd = true;
    bijstuurReden = `vertrouwen ${vertrouwen.toFixed(2)} onder drempel ${VERTROUWEN_DREMPEL}`;
  }

  return {
    intent,
    taal,
    vertrouwen,
    samenvatting: samenvatting || "geen samenvatting",
    bijgestuurd,
    bijstuurReden,
    kosten: antwoord.kosten,
  };
}

/** Kernfunctie: classificeer een mail in het compacte MailVoorClassificatie-formaat. */
export async function classificeerKern(mail: MailVoorClassificatie): Promise<ClassificatieKern> {
  let antwoord: ClaudeAntwoord;
  try {
    antwoord = await roepClaudeAan({
      model: kiesModel("MAILBOT_MODEL_CLASSIFICATIE", MODEL_CLASSIFICATIE),
      systeem: CLASSIFICATIE_SYSTEEM,
      gebruiker: classificatieGebruikerBlok(mail),
      maxTokens: 400,
      tool: CLASSIFICATIE_TOOL,
      // Sorteren is een simpele taak: geen thinking/effort nodig. Op Opus 4.8 en
      // Haiku 4.5 draait het zonder thinking wanneer we het veld weglaten.
    });
  } catch (e) {
    // Lukt de classificatie niet, dan is de veilige uitkomst mens_nodig met
    // vertrouwen 0. De poller escaleert dan met de originele mail.
    const bericht = e instanceof Error ? e.message : String(e);
    return {
      intent: "mens_nodig",
      taal: "en",
      vertrouwen: 0,
      samenvatting: "classificatie mislukt, mens nodig",
      bijgestuurd: true,
      bijstuurReden: `classificatie-aanroep mislukt: ${bericht}`,
      kosten: geenKosten(MODEL_CLASSIFICATIE),
    };
  }
  return verwerkClassificatieAntwoord(antwoord);
}

// ---------------------------------------------------------------------------
// Contractfunctie uit types.ts.

function leesTekstVeld(bron: Record<string, unknown>, ...namen: string[]): string {
  for (const naam of namen) {
    const waarde = bron[naam];
    if (typeof waarde === "string" && waarde.trim() !== "") return waarde;
    if (waarde instanceof Date && !Number.isNaN(waarde.getTime())) return waarde.toISOString();
  }
  return "";
}

/** Zet een InkomendeMail defensief om naar het formaat dat de prompt nodig heeft. */
export function mailNaarClassificatieInvoer(mail: InkomendeMail): MailVoorClassificatie {
  const bron = alsObject(mail) ?? {};
  return {
    van: leesTekstVeld(bron, "vanAdres", "van", "from", "afzender"),
    onderwerp: leesTekstVeld(bron, "onderwerp", "subject", "titel"),
    // InkomendeMail draagt de mailtekst in tekstSchoon (citaat en handtekening
    // eraf) met tekstVolledig als terugval. Die twee horen VOORAAN: zonder hen
    // kreeg het model een lege body en classificeerde het elke mail als
    // mens_nodig met vertrouwen 0,20, waardoor alles escaleerde.
    tekst: leesTekstVeld(bron, "tekstSchoon", "tekstVolledig", "tekst", "body", "bericht", "inhoud", "text"),
    ontvangenOp: leesTekstVeld(bron, "ontvangenOp", "ontvangenAt", "datum", "date") || undefined,
  };
}

/**
 * Contractfunctie (types.ts): classificeer een InkomendeMail.
 * Levert het gedeelde Classificatie-type. De concrete kern is los te testen
 * via classificeerKern.
 */
export async function classificeer(mail: InkomendeMail): Promise<Classificatie> {
  const kern = await classificeerKern(mailNaarClassificatieInvoer(mail));
  return {
    intent: kern.intent,
    taal: kern.taal,
    vertrouwen: kern.vertrouwen,
    samenvatting: kern.samenvatting,
    bijgestuurd: kern.bijgestuurd,
    bijstuurReden: kern.bijstuurReden,
    kostenUsd: kern.kosten.kostenUsd,
  } as unknown as Classificatie;
}
