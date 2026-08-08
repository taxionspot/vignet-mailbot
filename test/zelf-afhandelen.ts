// Test voor de beslissingen die de bot sinds 04-08 ZELF neemt in plaats van te
// escaleren. Draaien: npx tsx test/zelf-afhandelen.ts
//
// Wat hier bewaakt wordt, in volgorde van belang:
//   1. Een ECHTE juridische zaak (advocaat, incasso, toezichthouder, aangekondigde
//      terugboeking) mag NOOIT door de bot beantwoord worden.
//   2. Een feitelijke klacht mag dat alleen als alle poorten open staan: order
//      gevonden, afzender is de besteller, adres geauthenticeerd.
//   3. Een PayPal-kwestie wordt herkend en levert een dedupe-sleutel op, zodat
//      herinneringsmails niet elke keer een nieuwe case opleveren.
//   4. Een typefout in het besteladres wordt herkend, maar geeft nooit toegang.

import { beoordeelKlacht, magKlachtZelfBeantwoorden } from "../src/klacht.js";
import { leesPaypalKwestie } from "../src/paypal-kwestie.js";
import { lijktOpTypefout } from "../src/adres.js";
import { landUitTekst, bevestigtVoorstel } from "../src/landtekst.js";
import { isAfmeldVerzoek } from "../src/afmelden.js";

let goed = 0;
let fout = 0;
function check(naam: string, voorwaarde: boolean, extra = ""): void {
  if (voorwaarde) {
    goed += 1;
    console.log(`  ok   ${naam}`);
  } else {
    fout += 1;
    console.log(`  FOUT ${naam}${extra ? ` -> ${extra}` : ""}`);
  }
}

const POORTEN_OPEN = {
  heeftOrder: true,
  identiteitKlopt: true,
  afzenderGeauthenticeerd: true,
};

console.log("1. Echte juridische zaak blijft mensenwerk");
{
  // Letterlijk de soort zinnen die wij krijgen, in de talen van onze klanten.
  const zaken: Array<[string, string]> = [
    ["duits, advocaat", "Ich habe meinen Rechtsanwalt eingeschaltet und fordere Sie zur Zahlung auf."],
    ["duits, incasso", "Andernfalls gebe ich die Sache an ein Inkassobuero ab."],
    ["duits, verbraucherzentrale", "Ich habe die Verbraucherzentrale eingeschaltet."],
    ["duits, terugboeking", "Ich werde die Zahlung ueber meine Bank zurueckbuchen lassen."],
    ["nederlands, advocaat", "Mijn advocaat neemt contact met u op."],
    ["nederlands, ACM", "Ik doe melding bij de ACM en de Consumentenbond."],
    ["engels, chargeback", "I will file a chargeback with my credit card company."],
    ["engels, legal action", "I am considering legal action against your company."],
    ["frans, mise en demeure", "Ceci est une mise en demeure avant action en justice."],
    ["paypal-kwestie aangekondigd", "Ich habe bereits einen PayPal Kaeuferschutz Fall eroeffnet."],
  ];
  for (const [naam, tekst] of zaken) {
    const oordeel = beoordeelKlacht(tekst);
    check(`${naam} -> mens nodig`, oordeel.mensNodig, oordeel.signaal);
    const mag = magKlachtZelfBeantwoorden({ ...POORTEN_OPEN, tekst });
    check(`${naam} -> bot mag NIET zelf antwoorden`, !mag.mag, mag.reden);
  }
}

console.log("\n2. Feitelijke klacht mag de bot zelf doen");
{
  const feitelijk: Array<[string, string]> = [
    [
      "dacht dat het officieel was",
      "Ich dachte, ich kaufe im offiziellen ASFINAG-Shop. Erst danach habe ich gemerkt, dass Sie ein Vermittler sind. Ich bitte um Rueckerstattung.",
    ],
    [
      "servicekosten te hoog",
      "Der Preis ist viel hoeher als der offizielle Tarif. Die Servicegebuehr war nicht klar erkennbar.",
    ],
    ["geld terug na levering", "Ik wil mijn geld terug, ik heb dit per ongeluk besteld."],
    ["boos maar zonder dreiging", "Das ist eine Frechheit! Ich fuehle mich getaeuscht und will mein Geld zurueck."],
  ];
  for (const [naam, tekst] of feitelijk) {
    const oordeel = beoordeelKlacht(tekst);
    check(`${naam} -> geen mens nodig`, !oordeel.mensNodig, oordeel.signaal);
    const mag = magKlachtZelfBeantwoorden({ ...POORTEN_OPEN, tekst });
    check(`${naam} -> bot mag zelf antwoorden`, mag.mag, mag.reden);
  }
}

console.log("\n3. De poorten zelf");
{
  const tekst = "Ich moechte mein Geld zurueck, der Preis war zu hoch.";
  check(
    "zonder gevonden bestelling: niet zelf",
    !magKlachtZelfBeantwoorden({ ...POORTEN_OPEN, heeftOrder: false, tekst }).mag
  );
  check(
    "afzender is niet de besteller: niet zelf",
    !magKlachtZelfBeantwoorden({ ...POORTEN_OPEN, identiteitKlopt: false, tekst }).mag
  );
  check(
    "adres niet geauthenticeerd: niet zelf",
    !magKlachtZelfBeantwoorden({ ...POORTEN_OPEN, afzenderGeauthenticeerd: false, tekst }).mag
  );
  check("lege mail: niet zelf", !magKlachtZelfBeantwoorden({ ...POORTEN_OPEN, tekst: "" }).mag);
  check(
    "dreiging in het CITAAT onderaan telt ook",
    !magKlachtZelfBeantwoorden({
      ...POORTEN_OPEN,
      tekst: "Bitte um Rueckmeldung.\n\n> Am 03.08. schrieb ich: Ich schalte meinen Anwalt ein.",
    }).mag
  );
}

console.log("\n4. PayPal-kwesties herkennen en ontdubbelen");
{
  const kwestie = leesPaypalKwestie({
    vanAdres: "service@paypal.nl",
    onderwerp: "De koper heeft een kwestie ingediend",
    tekst:
      "Beste VignetteHub, u hebt een kwestie ontvangen. Kwestienummer PP-R-QVH-637866614 over transactie 11V201141S360482T.",
  });
  check("kwestiemail wordt herkend", kwestie.isKwestie);
  check("kwestienummer eruit gehaald", kwestie.kwestieNummer === "PP-R-QVH-637866614", String(kwestie.kwestieNummer));
  check("transactie-id eruit gehaald", kwestie.transactieIds.includes("11V201141S360482T"), kwestie.transactieIds.join(","));
  check("dedupe op het kwestienummer", kwestie.dedupeSleutel === "PP-R-QVH-637866614");

  const herinnering = leesPaypalKwestie({
    vanAdres: "service@paypal.nl",
    onderwerp: "Herinnering: Kwestienummer PP-R-QVH-637866614 wordt gesloten op 7 augustus 2026",
    tekst: "Reageer zo snel mogelijk.",
  });
  check("herinnering krijgt DEZELFDE dedupe-sleutel", herinnering.dedupeSleutel === kwestie.dedupeSleutel);

  const betaling = leesPaypalKwestie({
    vanAdres: "service@paypal.nl",
    onderwerp: "Betaling ontvangen van service@paypal.nl",
    tekst: "U hebt een betaling van 27,75 EUR ontvangen.",
  });
  check("gewone betaalmelding is GEEN kwestie", !betaling.isKwestie);

  const klant = leesPaypalKwestie({
    vanAdres: "boze.klant@web.de",
    onderwerp: "Ich eroeffne einen PayPal Streitfall",
    tekst: "Ich melde das bei PayPal.",
  });
  check("mail van een KLANT is geen PayPal-systeemmail", !klant.isKwestie);
}

console.log("\n5. Typefout in het besteladres");
{
  check("een letter verschil op hetzelfde domein", lijktOpTypefout("jana.petereit@dvag.de", "jana.perereit@dvag.de"));
  check("twee letters verschil bij een lang adres", lijktOpTypefout("alexander.krauss@web.de", "alexnder.kraus@web.de"));
  check("ander domein telt nooit", !lijktOpTypefout("jana.petereit@gmail.com", "jana.petereit@dvag.de"));
  check("compleet ander adres telt niet", !lijktOpTypefout("kraussj387@gmail.com", "alex_nataliekrauss@web.de"));
  check("kort adres telt niet", !lijktOpTypefout("bob@web.de", "rob@web.de"));
  check("identiek adres is geen typefout", !lijktOpTypefout("a.klant@web.de", "a.klant@web.de"));
}

console.log("\n6. Land uit het antwoord van de klant (05-08)");
{
  // Zo antwoorden klanten echt: met of zonder ontkenning van het foute land.
  check(
    "duits: niet Duitsland maar Roemenie",
    landUitTekst("Das Auto ist nicht in Deutschland zugelassen, sondern in Rumaenien.", "DE") === "RO"
  );
  check("nederlands: Belgie", landUitTekst("Mijn auto staat in Belgie geregistreerd.", "AT") === "BE");
  check("engels: Romania", landUitTekst("The car is registered in Romania, not Germany.", "DE") === "RO");
  check("frans: Belgique", landUitTekst("La voiture est immatriculee en Belgique.", "AT") === "BE");
  check("eigen naam telt ook: Ceska republika", landUitTekst("Auto je z Ceska republika.", "DE") === "CZ");
  check(
    "het HUIDIGE land negeren we, anders telt dat als tweede treffer",
    landUitTekst("Nicht Deutschland, sondern Rumaenien!", "DE") === "RO"
  );
  check("twee andere landen = geen mening", landUitTekst("Ik twijfel tussen Belgie en Frankrijk.", "DE") === null);
  check("geen land genoemd = null", landUitTekst("Het kenteken is XY-123-Z, klopt dat?", "DE") === null);
  check("lege tekst = null", landUitTekst("", "DE") === null);
  check(
    "losse lettergreep matcht niet (woordgrens)",
    landUitTekst("Ik heb de polenta al besteld.", "DE") === null
  );
}

console.log("\n7. Klant bevestigt ons landvoorstel (07-08)");
{
  // Sinds 07-08 meet de runner zelf of het portaal het kenteken bij een ANDER
  // land wel accepteert, en stelt de klant dan een concrete ja-nee-vraag. Dat
  // lokt korte antwoorden uit waar geen kenteken en geen landnaam in staat.
  check("kaal ja", bevestigtVoorstel("Ja"));
  check("ja met punt", bevestigtVoorstel("ja."));
  check("nederlands: klopt", bevestigtVoorstel("Dat klopt, bedankt!"));
  check("nederlands: inderdaad", bevestigtVoorstel("Inderdaad, dank u wel"));
  check("engels: yes", bevestigtVoorstel("Yes, that is correct."));
  check("engels: confirmed", bevestigtVoorstel("Confirmed"));
  check("duits: stimmt", bevestigtVoorstel("Ja, das stimmt."));
  check("duits: richtig", bevestigtVoorstel("Richtig"));
  check("frans: oui", bevestigtVoorstel("Oui, exact"));
  check("italiaans: si", bevestigtVoorstel("Si, corretto"));
  check("pools: tak", bevestigtVoorstel("Tak, zgadza sie"));
  check("tsjechisch: ano", bevestigtVoorstel("Ano, spravne"));

  // Alles wat GEEN duidelijke bevestiging is, mag niet doortellen: een fout hier
  // levert een vignet op het verkeerde registratieland op, en dat is ongeldig.
  check("ontkenning blokkeert", !bevestigtVoorstel("Nee, dat klopt niet."));
  check("engelse ontkenning blokkeert", !bevestigtVoorstel("No, that is not correct"));
  check("duitse ontkenning blokkeert", !bevestigtVoorstel("Nein, das stimmt nicht"));
  check("wedervraag is geen bevestiging", !bevestigtVoorstel("Ja? Hoezo dan?"));
  check("vraagteken blokkeert altijd", !bevestigtVoorstel("Klopt dat wel?"));
  check("leeg is geen bevestiging", !bevestigtVoorstel(""));
  check("alleen witruimte", !bevestigtVoorstel("   \n  "));
  check(
    "een heel verhaal is geen kort ja",
    !bevestigtVoorstel(
      "Ja ik heb uw mail ontvangen maar ik begrijp niet goed wat u bedoelt want ik heb de auto vorig jaar gekocht bij een dealer in een andere stad en toen stond er iets anders op de papieren dus ik weet het eigenlijk niet zeker meer"
    )
  );
  check("losse lettergreep matcht niet", !bevestigtVoorstel("Ik ben in Jakarta geweest"));
  check("woord met ja erin telt niet", !bevestigtVoorstel("Mijn jas is kwijt"));

  // Noemt de klant zelf een land, dan wint dat boven onze bevestiging. Dat
  // wordt in index.ts afgedwongen; hier controleren we dat beide signalen
  // onafhankelijk werken.
  check(
    "een genoemd land blijft leidend",
    landUitTekst("Ja klopt, de auto staat in Polen geregistreerd.", "DE") === "PL"
  );
}

console.log("\n8. Afmeld- of gegevensverwijderverzoek (08-08)");
{
  // Het echte bericht dat de aanleiding was (julia.kiesshauer, 07-08).
  check(
    "de echte aanleiding wordt herkend",
    isAfmeldVerzoek("Bitte entfernen Sie meine Daten. Die Vignette wird nicht benötigt.\nMfG")
  );
  check("kaal Abmelden (onderwerpregel)", isAfmeldVerzoek("Abmelden"));
  check("engels: unsubscribe", isAfmeldVerzoek("Unsubscribe please"));
  check("engels: delete my data", isAfmeldVerzoek("Please delete my data, I no longer need this."));
  check("nederlands: verwijder mijn gegevens", isAfmeldVerzoek("Verwijder mijn gegevens a.u.b."));
  check("nederlands: geen mails meer", isAfmeldVerzoek("Ik wil geen mails meer ontvangen"));
  check("duits: keine Mails mehr", isAfmeldVerzoek("Bitte keine Mails mehr an mich."));
  check("frans: supprimez mes donnees", isAfmeldVerzoek("Supprimez mes données s'il vous plaît"));

  // Wat er NIET op mag aanslaan: op dit signaal worden gegevens verwijderd.
  check("alleen 'niet nodig' is geen afmelding", !isAfmeldVerzoek("Die Vignette wird nicht benötigt."));
  check("annuleringsverzoek is geen afmelding", !isAfmeldVerzoek("Ich möchte meine Bestellung stornieren und mein Geld zurück."));
  check("statusvraag is geen afmelding", !isAfmeldVerzoek("Wo bleibt mein Vignette? Ich habe bezahlt."));
  check("lange mail valt af, ook met het woord erin", !isAfmeldVerzoek(
    "Ik heb een vraag over mijn bestelling van vorige week. Ik wil me niet afmelden maar ik begrijp de mail niet goed. " +
    "Er stond iets over een kenteken en een startdatum en ik weet niet of dat klopt want mijn man heeft de auto " +
    "vorige maand verkocht en we hebben nu een andere auto met een ander kenteken en andere papieren erbij gekregen."
  ));
  check("lege tekst", !isAfmeldVerzoek(""));
}

console.log(`\n==== ${goed} geslaagd, ${fout} gefaald ====`);
if (fout > 0) process.exitCode = 1;
