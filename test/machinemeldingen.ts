// Test voor de machinemelding-filter (26-07-2026): welke post mag zonder model
// gearchiveerd worden en welke moet ALTIJD de gewone weg blijven volgen.
//
// Draaien: npx tsx test/machinemeldingen.ts
//
// Het risico dat deze test afdekt is eenzijdig: een PayPal-mail die we onterecht
// filteren, is een geschil of een blokkade die niemand ziet. Vandaar dat er veel
// meer "moet doorlaten"-gevallen staan dan "mag filteren"-gevallen.

import type { InkomendeMail } from "../src/types.js";

// guards.ts leest config.ts, en die stopt zonder een volledige omgeving. Deze
// test raakt geen netwerk en geen postbus, dus vullen we hier onschuldige
// waarden in en importeren daarna pas. Zo draait de test ook op een machine
// zonder .env.
process.env.ZOHO_IMAP_HOST ??= "imap.voorbeeld.test";
process.env.ZOHO_IMAP_USER ??= "test@voorbeeld.test";
process.env.ZOHO_APP_PASSWORD ??= "test";
process.env.APP_BASIS_URL ??= "https://voorbeeld.test";
process.env.BOT_SECRET ??= "test";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.ESCALATIE_EMAIL ??= "test@voorbeeld.test";

const { machinemeldingReden } = await import("../src/guards.js");

let gedaan = 0;
let gezakt = 0;

function mail(van: string, onderwerp: string): InkomendeMail {
  return {
    uid: 1,
    botMailId: "<test@example.com>",
    ontvangenAt: new Date("2026-07-26T08:00:00Z"),
    vanNaam: "Test",
    vanAdres: van,
    onderwerp,
    tekstVolledig: "",
    tekstZonderCitaat: "",
    headers: {},
    isBounce: false,
  } as unknown as InkomendeMail;
}

function magFilteren(naam: string, van: string, onderwerp: string): void {
  gedaan += 1;
  const uit = machinemeldingReden(mail(van, onderwerp));
  if (uit) {
    console.log(`  ok   filtert: ${naam}`);
    return;
  }
  gezakt += 1;
  console.log(`  FOUT ${naam}: had gefilterd moeten worden, kreeg null`);
}

function moetDoor(naam: string, van: string, onderwerp: string): void {
  gedaan += 1;
  const uit = machinemeldingReden(mail(van, onderwerp));
  if (!uit) {
    console.log(`  ok   laat door: ${naam}`);
    return;
  }
  gezakt += 1;
  console.log(`  FOUT ${naam}: werd GEFILTERD (${uit}) maar moest doorgelaten worden`);
}

console.log("Machinemelding-filter");

// --- deze mogen weg zonder model ---
magFilteren("NL betaalmelding", "service@paypal.nl", "Betaling ontvangen van service@paypal.nl");
magFilteren("NL kennisgeving", "service@paypal.nl", "Kennisgeving: betaling ontvangen");
magFilteren("hoofdletters en spaties", "service@paypal.nl", "  BETALING ONTVANGEN van iemand ");
magFilteren("EN payment", "service@paypal.com", "You've received a payment");
magFilteren("EN payment, ander apostrof", "service@paypal.com", "You’ve received a payment");
magFilteren("DE Zahlungseingang", "service@paypal.de", "Zahlungseingang");
magFilteren("subdomein", "service@mail.paypal.nl", "Betaling ontvangen van klant");

// --- deze moeten ALTIJD langs het model, want ze raken geld of recht ---
moetDoor("geschil", "service@paypal.nl", "De koper heeft een kwestie ingediend");
moetDoor("dispute EN", "service@paypal.com", "A buyer opened a dispute");
moetDoor("chargeback", "service@paypal.nl", "Chargeback ontvangen voor transactie");
moetDoor("terugbetaling", "service@paypal.nl", "Betaling ontvangen, terugbetaling gestart");
moetDoor("beperking op het account", "service@paypal.nl", "Uw account is beperkt");
moetDoor("actie vereist", "service@paypal.nl", "Actie vereist: betaling ontvangen maar vastgehouden");
moetDoor("Streitfall", "service@paypal.de", "Zahlungseingang: Streitfall eroeffnet");
moetDoor("wachtwoord", "service@paypal.nl", "Uw wachtwoord is gewijzigd");

// --- niet in de lijst: gaat gewoon door ---
moetDoor("echte klant", "klant@example.com", "Betaling ontvangen?");
moetDoor("lijkt op paypal maar is het niet", "service@paypal.nl.phish.example", "Betaling ontvangen");
moetDoor("paypal maar onbekend onderwerp", "service@paypal.nl", "Nieuwe voorwaarden per 1 augustus");
moetDoor("leeg onderwerp", "service@paypal.nl", "");
moetDoor("geen afzender", "", "Betaling ontvangen");
moetDoor("onderwerp begint niet met het patroon", "service@paypal.nl", "Re: Betaling ontvangen, vraag");
moetDoor("Zoho-bounce", "mailer-daemon@mail.zoho.eu", "Undelivered Mail Returned to Sender");
moetDoor("DMARC-rapport", "noreply-dmarc@sicher.gmx.net", "Report Domain: vignettehub.com");

console.log(`\n${gedaan - gezakt}/${gedaan} checks in orde`);
if (gezakt > 0) {
  console.error(`${gezakt} check(s) GEZAKT`);
  process.exit(1);
}
