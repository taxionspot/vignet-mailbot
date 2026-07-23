// Droogloop met het ECHTE model, zonder IMAP en zonder verzenden.
//
// Doel: met eigen ogen zien wat de bot nu zelf afhandelt sinds de wijziging van
// 24-07 (minder escaleren). Elk scenario gaat door de echte opsteller en daarna
// door de echte controlelaag. Er wordt niets verstuurd en er verandert niets
// aan een bestelling; alleen de Anthropic-API wordt aangeroepen.
//
// Draaien op de VM (daar staat ANTHROPIC_API_KEY in .env):
//   cd /opt/vignet-mailbot && npx tsx test/proef-antwoorden.ts
//
// Kosten: een handvol modelaanroepen, orde grootte een paar cent.

import { stelOpKern } from "../src/compose.js";
import { controleerConceptKern } from "../src/verify.js";
import { bouwFeitenBlok } from "../src/feiten.js";
import { classificeerKern } from "../src/classify.js";
import type { BotIntent } from "../src/prompts/classificatie.js";

// Voorbeeldorder: Oostenrijk 10-daags, in de wachtrij, betaald.
const ORDER = {
  orderToken: "VH-ABCDE",
  land: "at",
  landNaam: "Oostenrijk",
  productNaam: "10-dagenvignet",
  plateWeergave: "AB-123-C",
  startDate: "2026-08-01",
  fulfilmentStatus: "QUEUED",
  paymentStatus: "COMPLETED",
  email: "klant@example.com",
  uiLocale: "nl",
  totCents: 2455,
  currency: "EUR",
  statusToken: "TESTTOKEN",
  bewijsBeschikbaar: false,
  alTerugbetaaldCents: 0,
};

interface Scenario {
  naam: string;
  /** Mail van de klant. */
  van: string;
  onderwerp: string;
  tekst: string;
  /** Order meesturen of niet. */
  metOrder: boolean;
  /** Mag de bot om het ordernummer vragen? */
  magOrderVragen?: boolean;
  /** Wat we verwachten, puur als leeswijzer bij de uitvoer. */
  verwacht: string;
}

const SCENARIOS: Scenario[] = [
  {
    naam: "1. Algemene vraag, geen bestelling (ging vroeger naar Sabur)",
    van: "onbekend@example.com",
    onderwerp: "Vraag over Tsjechie",
    tekst: "Goedendag, ik rijd volgende week door Tsjechie naar Kroatie. Heb ik daar een vignet nodig en is het meteen geldig?",
    metOrder: false,
    verwacht: "zelf beantwoorden uit de kennisbank, geen escalatie, geen bedrag",
  },
  {
    naam: "2. Vraag over motor en caravan, geen bestelling",
    van: "onbekend@example.com",
    onderwerp: "Motor en aanhanger",
    tekst: "Ik ga met de motor naar Oostenrijk en mijn vrouw rijdt met de auto plus caravan. Hebben wij allebei een vignet nodig?",
    metOrder: false,
    verwacht: "uitleg over motoren en aanhangers, doorverwijzing voor het motorvignet",
  },
  {
    naam: "3. Statusvraag zonder gevonden bestelling (vroeger escalatie)",
    van: "onbekend@example.com",
    onderwerp: "Waar blijft mijn vignet",
    tekst: "Ik heb gisteren betaald maar ik heb nog niets ontvangen. Kunnen jullie kijken waar het blijft?",
    metOrder: false,
    magOrderVragen: true,
    verwacht: "zelf om ordernummer of kenteken vragen, geen ordergegevens, geen belofte",
  },
  {
    naam: "4. Statusvraag met bestelling",
    van: ORDER.email,
    onderwerp: "Waar blijft mijn vignet",
    tekst: "Hallo, ik heb besteld voor Oostenrijk. Wanneer is het geregeld?",
    metOrder: true,
    verwacht: "status uit de feiten, verwijzing naar de statuspagina",
  },
  {
    naam: "5. Prijsvraag zonder bestelling (verboden terrein: geen bedragen)",
    van: "onbekend@example.com",
    onderwerp: "Wat kost het",
    tekst: "Wat kost een vignet voor Bulgarije voor een week, en wat rekenen jullie erbovenop?",
    metOrder: false,
    verwacht: "geen enkel bedrag, verwijzing naar de site, geen splitsing servicekosten",
  },
  {
    naam: "6. Annuleren voor inkoop, met bestelling",
    van: ORDER.email,
    onderwerp: "Annuleren",
    tekst: "Onze reis gaat niet door, kan ik de bestelling annuleren en mijn geld terugkrijgen?",
    metOrder: true,
    verwacht: "bevestigen dat het geregeld is, bedrag alleen uit de feiten",
  },
];

function kop(tekst: string): void {
  console.log(`\n${"=".repeat(72)}\n${tekst}\n${"=".repeat(72)}`);
}

async function run(): Promise<void> {
  let mislukt = 0;

  for (const s of SCENARIOS) {
    kop(s.naam);
    console.log(`Mail van ${s.van}: ${s.tekst}`);
    console.log(`Verwacht: ${s.verwacht}\n`);

    // Stap 1: de echte classificatie.
    const klass = await classificeerKern({ van: s.van, onderwerp: s.onderwerp, tekst: s.tekst });
    console.log(
      `Classificatie: ${klass.intent}, taal ${klass.taal}, vertrouwen ${klass.vertrouwen.toFixed(2)}` +
        (klass.bijgestuurd ? ` (bijgestuurd: ${klass.bijstuurReden})` : ""),
    );

    // Stap 2: de echte opsteller.
    const feiten = bouwFeitenBlok(s.metOrder ? (ORDER as never) : null);
    const concept = await stelOpKern(
      klass.intent as BotIntent,
      { van: s.van, onderwerp: s.onderwerp, tekst: s.tekst },
      feiten,
      klass.taal,
      { magOrderVragen: s.magOrderVragen ?? true },
    );

    if (concept.escaleren) {
      console.log(`\nESCALEERT naar Sabur: ${concept.escalatieReden}`);
      mislukt += 1;
      continue;
    }

    // Stap 3: de echte controlelaag.
    const controle = controleerConceptKern({ tekst: concept.tekst, taal: concept.taal }, feiten.bedragenCents);
    console.log(`\nAntwoord (${concept.taal}):\n${concept.tekst}`);
    console.log(`\nControle: ${controle.ok ? "goedgekeurd" : `AFGEKEURD (${controle.code}: ${controle.reden})`}`);
    if (!controle.ok) mislukt += 1;
  }

  kop(`Klaar. ${SCENARIOS.length - mislukt} van de ${SCENARIOS.length} scenario's zelf afgehandeld.`);
  if (mislukt > 0) {
    console.log("Let op: alles wat escaleert of afgekeurd wordt, ging naar Sabur toe.");
  }
}

run().catch((e) => {
  console.error("proef geklapt:", e);
  process.exit(1);
});
