// Van mail naar order (spec sectie 4). De volgorde is hard, eerste treffer wint:
//
//   1. VH-XXXXX in onderwerp of body (ook in de aangehaalde tekst eronder).
//   2. Afzenderadres tegen order.email. Meerdere orders = de nieuwste.
//   3. Kenteken uit de body tegen plate (genormaliseerd A-Z0-9).
//
// Geen match = de aanroeper zet intent mens_nodig en escaleert, nooit gokken.
//
// De identiteitsregel (sectie 4, hard) staat hier als aparte, expliciet
// benoemde functie identiteitKlopt(), zodat hij los te testen is: de bot
// handelt alleen als het afzenderadres EXACT gelijk is aan order.email
// (kleine letters, getrimd). Klopt dat niet, dan geen gegevens, geen actie.

import { haalOrder } from "./api.js";
import { log } from "./log.js";
import type { InkomendeMail, OrderFeiten } from "./types.js";

export type MatchWijze = "token" | "email" | "plaat" | "geen";

export interface MatchResultaat {
  /** De gevonden feitenset, of null als er niets paste. */
  order: OrderFeiten | null;
  /** Hoe de order gevonden is. */
  wijze: MatchWijze;
  /** Aantal orders dat op deze zoekvraag paste (>1 = de nieuwste is gekozen). */
  aantalGevonden: number;
  /**
   * True als er WEL een order gevonden is, maar de afzender niet de besteller
   * is. De aanroeper mag dan geen enkel ordergegeven prijsgeven en escaleert.
   */
  identiteitMismatch: boolean;
}

// ---------------------------------------------------------------------------
// De identiteitsregel (sectie 4, hard)
// ---------------------------------------------------------------------------

/**
 * True zodra het afzenderadres exact gelijk is aan order.email, allebei in
 * kleine letters en getrimd. Dit is de enige poort waarlangs de bot
 * ordergegevens mag tonen of een actie mag uitvoeren.
 *
 * Bewust een aparte, pure functie zodat de tests hem los kunnen controleren.
 */
export function identiteitKlopt(afzenderAdres: string, order: OrderFeiten): boolean {
  const van = (afzenderAdres ?? "").trim().toLowerCase();
  const orderEmail = (order.email ?? "").trim().toLowerCase();
  if (!van || !orderEmail) return false;
  return van === orderEmail;
}

// ---------------------------------------------------------------------------
// VH-nummer uit de tekst halen
// ---------------------------------------------------------------------------

// VH-XXXXX, precies vijf tekens, niet als deel van een langere reeks. Case
// insensitief, resultaat in hoofdletters. De lookbehind en lookahead voorkomen
// dat we een langere reeks als VH-ABCDEFGH aanzien voor een geldig token.
const VH_PATROON = /(?<![A-Z0-9])VH-([A-Z0-9]{5})(?![A-Z0-9])/gi;

/** Eerste VH-nummer in de tekst, in hoofdletters, of null. */
export function zoekVhNummer(tekst: string): string | null {
  VH_PATROON.lastIndex = 0;
  const m = VH_PATROON.exec(tekst ?? "");
  if (!m) return null;
  return `VH-${m[1].toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Kenteken normaliseren en kandidaten oogsten
// ---------------------------------------------------------------------------

// Zelfde normalisatie als de app: hoofdletters, Duitse umlauten transliteren,
// daarna alles wat geen A-Z of 0-9 is weggooien.
export function normaliseerPlaat(ruw: string): string {
  return (ruw ?? "")
    .toUpperCase()
    .replace(/AE/g, "A")
    .replace(/OE/g, "O")
    .replace(/UE/g, "U")
    .replace(/Ä/g, "A")
    .replace(/Ö/g, "O")
    .replace(/Ü/g, "U")
    .replace(/ß/g, "S")
    .replace(/[^A-Z0-9]/g, "");
}

// Kandidaat-kentekens uit de tekst. Een kandidaat is een reeks letters en
// cijfers, eventueel met streepjes of spaties ertussen (MU-AB 123), die
// genormaliseerd 5 tot 8 tekens oplevert en minstens een cijfer bevat. Het
// cijfer-vereiste snoeit gewone woorden weg; vrijwel elk Europees kenteken
// heeft cijfers. We houden de volgorde aan en ontdubbelen.
export function kandidaatPlaten(tekst: string, uitsluiten: string[] = []): string[] {
  const uitgesloten = new Set(uitsluiten.map((s) => normaliseerPlaat(s)));
  const kandidaten: string[] = [];
  const gezien = new Set<string>();

  // Groepen van letters/cijfers, gescheiden door hoogstens een streepje of
  // spatie, zoals ze op een kentekenplaat staan.
  const groep = /[A-Za-zÄÖÜäöüß0-9]+(?:[\s-][A-Za-zÄÖÜäöüß0-9]+){0,3}/g;
  let m: RegExpExecArray | null;
  while ((m = groep.exec(tekst ?? "")) !== null) {
    const genormaliseerd = normaliseerPlaat(m[0]);
    if (genormaliseerd.length < 5 || genormaliseerd.length > 8) continue;
    if (!/[0-9]/.test(genormaliseerd)) continue; // moet minstens een cijfer hebben
    if (!/[A-Z]/.test(genormaliseerd)) continue; // en minstens een letter
    if (uitgesloten.has(genormaliseerd)) continue;
    if (gezien.has(genormaliseerd)) continue;
    gezien.add(genormaliseerd);
    kandidaten.push(genormaliseerd);
  }
  return kandidaten;
}

// ---------------------------------------------------------------------------
// De matching zelf
// ---------------------------------------------------------------------------

// Klein hulpje: uit een MatchResultaat maken met de identiteitscheck erin
// verwerkt. wijze en aantal komen van de aanroeper.
function bouwResultaat(mail: InkomendeMail, order: OrderFeiten, wijze: MatchWijze, aantal: number): MatchResultaat {
  return {
    order,
    wijze,
    aantalGevonden: aantal,
    identiteitMismatch: !identiteitKlopt(mail.vanAdres, order),
  };
}

/**
 * Zoekt de order bij een mail, in de volgorde uit sectie 4. Gooit alleen als de
 * app onbereikbaar is (ApiFout); de aanroeper vangt dat af en verplaatst de
 * mail naar Bot/Fout.
 */
export async function matchOrder(mail: InkomendeMail): Promise<MatchResultaat> {
  // Stap 1: VH-nummer. Eerst in het onderwerp, dan in de volledige tekst
  // (inclusief het citaat eronder, want daar staat het antwoord-VH vaak).
  const vhOnderwerp = zoekVhNummer(mail.onderwerp);
  const vhBody = zoekVhNummer(mail.tekstVolledig);
  const vhNummer = vhOnderwerp ?? vhBody;
  if (vhNummer) {
    const antwoord = await haalOrder({ soort: "token", token: vhNummer });
    if (antwoord.ok && antwoord.order) {
      log.debug(`Order gematcht op token ${vhNummer}`);
      return bouwResultaat(mail, antwoord.order, "token", antwoord.aantalGevonden ?? 1);
    }
    // VH-nummer genoemd maar niet gevonden: niet gokken op email/plaat, want
    // de klant verwijst duidelijk naar een specifieke order. Val door, maar de
    // kans dat email of plaat een ANDERE order oplevert willen we niet: als de
    // klant een concreet nummer noemt dat niet bestaat, is dat een mens-geval.
    log.debug(`VH-nummer ${vhNummer} genoemd maar niet gevonden`);
    return { order: null, wijze: "geen", aantalGevonden: 0, identiteitMismatch: false };
  }

  // Stap 2: afzenderadres tegen order.email. Meerdere orders = de nieuwste
  // (de app sorteert op createdAt en geeft aantalGevonden mee).
  if (mail.vanAdres) {
    const antwoord = await haalOrder({ soort: "email", email: mail.vanAdres });
    if (antwoord.ok && antwoord.order) {
      log.debug(`Order gematcht op email ${mail.vanAdres}`);
      return bouwResultaat(mail, antwoord.order, "email", antwoord.aantalGevonden ?? 1);
    }
  }

  // Stap 3: kenteken uit de body. Kandidaten in volgorde proberen; eerste
  // treffer wint. Het VH-nummer sluiten we uit als kandidaat (kan er niet
  // uitzien als plaat, maar voor de zekerheid).
  const platen = kandidaatPlaten(mail.tekstVolledig, vhNummer ? [vhNummer] : []);
  for (const plaat of platen) {
    const antwoord = await haalOrder({ soort: "plaat", plaat });
    if (antwoord.ok && antwoord.order) {
      log.debug(`Order gematcht op kenteken ${plaat}`);
      return bouwResultaat(mail, antwoord.order, "plaat", antwoord.aantalGevonden ?? 1);
    }
  }

  // Niets gevonden.
  return { order: null, wijze: "geen", aantalGevonden: 0, identiteitMismatch: false };
}
