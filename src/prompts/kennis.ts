// Vaste kennisbank voor de opsteller. Dit is het ENIGE inhoudelijke materiaal
// waar de bot uit mag putten naast de feitenset van de order. Alle feiten hier
// komen uit lib/vignet/config.ts en lib/vignet/runbook.ts van de app; er wordt
// niets verzonnen.
//
// De tekst is in het Nederlands als context voor het model. Het model
// beantwoordt de mail in de taal van de klant en vertaalt deze feiten daarnaartoe.
// Portaalnamen en links zijn taalneutraal en blijven zoals ze zijn.
//
// Merkregel: klant-facing heet de dienst altijd VignetteHub, nooit iets anders.

export interface LandKennis {
  code: string;
  naam: string;
  /** Naam van de officiele operator/portaal, voor doorverwijzing na inkoop. */
  operatorNaam: string;
  /** Officiele operator-site: alleen noemen bij annuleren of restitutie na inkoop. */
  operatorUrl: string;
  /** Zelf-controlelink waar de klant zijn vignet kan nazoeken. */
  checkUrl: string;
  /** Klant-veilige feiten per land, al in gewone taal. */
  feiten: string[];
}

// Bron: LANDEN in lib/vignet/config.ts + de klant-veilige delen van RUNBOOKS.
export const LANDEN_KENNIS: Record<string, LandKennis> = {
  at: {
    code: "at",
    naam: "Oostenrijk",
    operatorNaam: "ASFINAG",
    operatorUrl: "https://shop.asfinag.at",
    checkUrl: "https://shop.asfinag.at/en/evignettes/query",
    feiten: [
      "Producten: 1 dag, 10 dagen, 2 maanden en jaarvignet.",
      "Het 1-daags en 10-daags vignet zijn direct geldig, ook als de klant vandaag als ingangsdatum kiest.",
      "Het 2-maanden en het jaarvignet starten door het herroepingsrecht minimaal 18 dagen na aankoop, dat is een wettelijke regel, geen keuze van ons.",
      "Maximaal 30 dagen vooruit boeken.",
      "Kentekencorrectie kan zolang wij nog niet hebben ingekocht: de klant doet dat zelf via de knop op de statuspagina.",
    ],
  },
  ch: {
    code: "ch",
    naam: "Zwitserland",
    operatorNaam: "BAZG (via.admin.ch)",
    operatorUrl: "https://via.admin.ch/shop/",
    checkUrl: "https://via.admin.ch/shop/enquiry/evignette",
    feiten: [
      "Er is maar een Zwitsers vignet: het jaarvignet, geldig tot en met 31 januari van het volgende jaar.",
      "Het Zwitserse vignet is direct geldig bij aankoop, daarom registreren wij het op de door de klant gekozen ingangsdatum.",
      "Een kenteken is bij Zwitserland maar een keer te corrigeren, en alleen binnen 24 uur, dus dubbel controleren.",
    ],
  },
  cz: {
    code: "cz",
    naam: "Tsjechie",
    operatorNaam: "edalnice.gov.cz",
    operatorUrl: "https://edalnice.gov.cz/en",
    checkUrl: "https://edalnice.gov.cz/en/verification",
    feiten: [
      "Producten: 10 dagen, 30 dagen en jaarvignet.",
      "Alle Tsjechische vignetten zijn direct geldig na registratie.",
      "Maximaal 30 dagen vooruit boeken.",
      "Een typefout in het kenteken kost bij Tsjechie een betaalde en trage correctieprocedure, dus controleer het kenteken goed voor inkoop.",
    ],
  },
  sk: {
    code: "sk",
    naam: "Slowakije",
    operatorNaam: "eznamka.sk",
    operatorUrl: "https://eznamka.sk/selfcare/purchase",
    checkUrl: "https://eznamka.sk/selfcare/modification",
    feiten: [
      "Producten: 10 dagen, 30 dagen en 365 dagen.",
      "Alle Slowaakse vignetten zijn direct geldig na registratie.",
      "Maximaal 60 dagen vooruit boeken.",
      "Een kentekencorrectie kan bij Slowakije alleen voor de eerste geldigheidsdag of binnen 15 minuten na aankoop.",
    ],
  },
  ro: {
    code: "ro",
    naam: "Roemenie",
    operatorNaam: "CNAIR (erovinieta.ro)",
    operatorUrl: "https://www.erovinieta.ro",
    checkUrl: "https://www.erovinieta.ro/vignettes-portal-web/",
    feiten: [
      "Producten: 1 dag, 10 dagen, 30 dagen, 60 dagen en 12 maanden (rovinieta).",
      "Alle Roemeense vignetten zijn direct geldig na registratie.",
      "Maximaal 30 dagen vooruit boeken.",
      "Roemenie registreert het vignet op kenteken en op chassisnummer (serie sasiu), dus beide moeten kloppen.",
      "Een kentekenfout is bij Roemenie alleen binnen 60 minuten na uitgifte gratis te herstellen. Daarna loopt een schriftelijke procedure bij CNAIR van maximaal 5 werkdagen.",
    ],
  },
  bg: {
    code: "bg",
    naam: "Bulgarije",
    operatorNaam: "BG Toll (web.bgtoll.bg)",
    operatorUrl: "https://web.bgtoll.bg",
    checkUrl: "https://check.bgtoll.bg",
    feiten: [
      "Producten: 1 dag, weekend, 1 week, 1 maand, 3 maanden en jaarvignet.",
      "Het weekendvignet is een vast venster van vrijdag 12:00 tot zondag 23:59, ongeacht de gekozen startdatum.",
      "De overige Bulgaarse vignetten zijn direct geldig na registratie.",
      "Maximaal 30 dagen vooruit boeken.",
      "Bij Bulgarije is een kenteken alleen te corrigeren als er hoogstens 3 tekens fout staan; meer dan 3 fout betekent een nieuw vignet.",
      "Neem het kenteken exact over zoals op het bord: 0 (nul) en O (letter) zijn niet uitwisselbaar.",
    ],
  },
};

export function landKennis(code: string | undefined | null): LandKennis | null {
  if (!code) return null;
  return LANDEN_KENNIS[code.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Algemene kennis die voor elke mail geldt.

export const ALGEMENE_KENNIS: string[] = [
  "VignetteHub is een onafhankelijke bestelservice. Wij zijn geen overheid en geen officieel portaal. Wij bestellen namens de klant bij het officiele portaal van het betreffende land en rekenen daar transparante servicekosten voor.",
  "Een digitaal vignet is gekoppeld aan het kenteken. Er is geen sticker en geen QR-code die op de auto moet: de handhaving gebeurt met camera's die het kenteken lezen. De klant hoeft dus niets op de ruit te plakken.",
  "Omdat het vignet aan het kenteken hangt, krijgt de klant geen fysiek bewijs of QR-sticker. Wij sturen wel een eigen bewijs-PDF zodra het vignet geregistreerd en geleverd is; die staat op de statuspagina.",
  "Wij rekenen transparante servicekosten bovenop het officiele tarief van het portaal. Noem tegenover de klant altijd alleen het totaalbedrag uit de feitenset, nooit de splitsing tussen het officiele tarief en de servicekosten en nooit een los servicebedrag.",
  "Zolang wij een bestelling nog niet hebben ingekocht, kan de klant het kenteken zelf corrigeren via de knop op zijn statuspagina.",
  "Levering duurt normaal ongeveer 12 minuten nadat wij een order oppakken. Beloof nooit een exacte tijd, zeg dat het meestal snel klaar is en dat de klant een mail met bewijs krijgt zodra het geregistreerd is.",
];

// De annuleerregel, exact volgens spec sectie 6. Dit is de enige regel over geld.
export const ANNULEER_REGEL: string[] = [
  "Annuleren voor inkoop: zolang wij het vignet nog niet hebben ingekocht, kan de klant kosteloos annuleren en krijgt hij alles terug. Dit gebeurt automatisch, wij zetten de bestelling stop en betalen het volledige bedrag terug.",
  "Annuleren na inkoop: is het vignet eenmaal ingekocht, dan staat het geregistreerd op het kenteken van de klant en kunnen wij het niet terugdraaien. Een eventuele annulering of restitutie loopt dan bij de operator zelf.",
  "Beloof bij een annulering na inkoop nooit een uitkomst. Zeg niet dat de operator het terugbetaalt, maar dat de operator daarover beslist. Geef de klant de naam en de link van het juiste portaal mee.",
];

// ---------------------------------------------------------------------------

/**
 * Bouwt het kennisblok voor de systeemprompt. Is het land bekend, dan krijgt
 * dat land voorrang en laten we de andere landen weg om het model te focussen
 * en tokens te sparen. Is het land onbekend, dan komen alle zes de landen mee.
 */
export function kennisBlok(landCode?: string | null): string {
  const gekozen = landKennis(landCode);
  const landen = gekozen ? [gekozen] : Object.values(LANDEN_KENNIS);

  const landRegels = landen.map((l) =>
    [
      `${l.naam} (portaal: ${l.operatorNaam})`,
      ...l.feiten.map((f) => `  - ${f}`),
      `  - Officiele operator voor een annuleer- of restitutieverzoek na inkoop: ${l.operatorNaam}, ${l.operatorUrl}`,
      `  - Zelf een vignet controleren kan op: ${l.checkUrl}`,
    ].join("\n"),
  );

  return [
    "KENNISBANK (gebruik alleen wat hier staat, verzin niets):",
    "",
    "Algemeen:",
    ...ALGEMENE_KENNIS.map((r) => `- ${r}`),
    "",
    "Annuleren en terugbetalen:",
    ...ANNULEER_REGEL.map((r) => `- ${r}`),
    "",
    gekozen ? `Land van deze bestelling:` : "Landen die wij bedienen:",
    ...landRegels,
  ].join("\n");
}
