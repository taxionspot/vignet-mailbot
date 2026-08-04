// PayPal-kwesties herkennen en verrijken (besluit Sabur 04-08).
//
// PROBLEEM: een kwestiemail van PayPal ("De koper heeft een kwestie ingediend")
// gaat langs het machinemelding-filter (dat is de bedoeling, want zoiets mag
// nooit stil verdwijnen) en komt dan bij het model terecht. Dat labelt hem als
// klacht_juridisch of mens_nodig, kan er geen bestelling bij vinden (zo'n mail
// noemt geen ordernummer) en escaleert. Resultaat op 04-08: twee inhoudsloze
// cases zonder order, en bij elke herinneringsmail van PayPal komt er weer een.
//
// OPLOSSING: deze mails deterministisch herkennen, het KWESTIENUMMER en de
// TRANSACTIE eruit halen, en de bestelling opzoeken via het transactie-id. De
// escalatie krijgt dan de order, het bedrag en de link naar het zaakdossier
// mee, en alle vervolgmails over dezelfde kwestie worden ontdubbeld op het
// kwestienummer.
//
// De bot antwoordt hier NOOIT op: PayPal is geen klant en de afzender is een
// no-reply-adres.

/** Domeinen waarvan we PayPal-post accepteren. */
const PAYPAL_DOMEINEN = ["paypal.nl", "paypal.com", "paypal.de", "paypal.at", "paypal.be", "paypal.fr"];

// Onderwerpen die over een kwestie, geschil of terugboeking gaan. Ruim genomen
// in de talen die PayPal ons stuurt; bij twijfel matchen we liever te veel, want
// de uitkomst is alleen dat de escalatie beter wordt, niet dat er iets vervalt.
const KWESTIE_ONDERWERP =
  /(kwestie|geschil|dispute|claim|chargeback|terugboeking|r[uü]ckbuchung|streitfall|beschwerde|reclamaci|contestazione|litige|case (id|number)?)/i;

/** Kwestienummer zoals PayPal het schrijft: PP-R-XXX-123456789 of PP-D-... */
const KWESTIE_NUMMER = /\bPP-[A-Z]-[A-Z0-9]{2,4}-\d{5,}\b/i;
/** Transactie- of capture-id: 17 tekens, hoofdletters en cijfers. */
const TRANSACTIE_ID = /\b[A-Z0-9]{17}\b/g;

export interface PaypalKwestie {
  /** True als deze mail over een kwestie of terugboeking gaat. */
  isKwestie: boolean;
  /** PP-R-... als PayPal het noemde, anders null. */
  kwestieNummer: string | null;
  /** Kandidaat transactie-ids uit de mail, meest waarschijnlijke eerst. */
  transactieIds: string[];
  /**
   * Sleutel om vervolgmails over dezelfde kwestie te ontdubbelen. Het
   * kwestienummer als dat er is, anders het eerste transactie-id; is er geen
   * van beide, dan null en valt de bot terug op het normale gedrag.
   */
  dedupeSleutel: string | null;
}

function isPaypalAfzender(vanAdres: string): boolean {
  const domein = String(vanAdres ?? "").split("@")[1]?.toLowerCase() ?? "";
  if (!domein) return false;
  return PAYPAL_DOMEINEN.some((d) => domein === d || domein.endsWith(`.${d}`));
}

/**
 * Beoordeelt een binnengekomen mail. Puur op tekst en afzender, geen netwerk,
 * dus los te testen.
 */
export function leesPaypalKwestie(invoer: {
  vanAdres: string;
  onderwerp: string;
  tekst: string;
}): PaypalKwestie {
  const leeg: PaypalKwestie = {
    isKwestie: false,
    kwestieNummer: null,
    transactieIds: [],
    dedupeSleutel: null,
  };
  if (!isPaypalAfzender(invoer.vanAdres)) return leeg;
  const onderwerp = String(invoer.onderwerp ?? "");
  const tekst = String(invoer.tekst ?? "");
  if (!KWESTIE_ONDERWERP.test(onderwerp) && !KWESTIE_ONDERWERP.test(tekst.slice(0, 1500))) {
    return leeg;
  }

  const nummer = (`${onderwerp}\n${tekst}`.match(KWESTIE_NUMMER) ?? [])[0]?.toUpperCase() ?? null;

  // Transactie-ids: PayPal noemt er soms meerdere (de betaling en de kwestie).
  // Ontdubbelen met behoud van volgorde; het eerste is doorgaans de betaling.
  TRANSACTIE_ID.lastIndex = 0;
  const ids: string[] = [];
  for (const m of `${onderwerp}\n${tekst}`.matchAll(TRANSACTIE_ID)) {
    const id = m[0].toUpperCase();
    // Een kwestienummer bevat streepjes en valt hier dus niet onder, maar een
    // los woord van 17 hoofdletters zonder cijfer is geen transactie-id.
    if (!/\d/.test(id)) continue;
    if (!ids.includes(id)) ids.push(id);
    if (ids.length >= 5) break;
  }

  return {
    isKwestie: true,
    kwestieNummer: nummer,
    transactieIds: ids,
    dedupeSleutel: nummer ?? ids[0] ?? null,
  };
}
