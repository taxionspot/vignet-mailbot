// Vaste kennisbank voor de opsteller. Dit is het ENIGE inhoudelijke materiaal
// waar de bot uit mag putten naast de feitenset van de order.
//
// HERKOMST (belangrijk): elke regel hieronder is op 24-07 uit de app zelf
// gehaald en daarna nog eens tegen de broncode geverifieerd (lib/vignet/
// config.ts, lib/vignet/cutoff.ts, lib/vignet/runbook.ts, de algemene
// voorwaarden, de herroepingspagina, de landpagina's en de veelgestelde
// vragen). Er staat hier niets in dat de site niet zelf ook zegt. Verandert er
// iets aan het aanbod of aan de voorwaarden, dan hoort dat hier mee te
// veranderen, anders vertelt de bot iets wat niet meer klopt.
//
// WAAROM ZO UITGEBREID: tot 24-07 had de bot zes algemene feiten. Alles wat
// daarbuiten viel liep op "dit weet ik niet" uit en dus op een escalatie naar
// Sabur. De opdracht is nu: zoveel mogelijk zelf afhandelen. Hoe meer echte
// feiten hier staan, hoe minder mails er naar een mens gaan.
//
// De tekst is in het Nederlands als context voor het model. Het model
// beantwoordt de mail in de taal van de klant en vertaalt deze feiten daarnaartoe.
// Portaalnamen en links zijn taalneutraal en blijven zoals ze zijn.
//
// Merkregel: klant-facing heet de dienst altijd VignetteHub, nooit iets anders.
//
// GELDREGEL: hier staan bewust GEEN bedragen. Niet van ons, niet van boetes,
// niet van portalen. Het enige bedrag dat de bot mag noemen is het bedrag uit
// de feitenset van de bestelling zelf; verify.ts keurt elk ander bedrag af en
// dan escaleert de mail alsnog. Prijsvragen beantwoordt de bot door naar de
// site te verwijzen, waar de klant het totaalbedrag ziet voordat hij betaalt.

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

// Bron: LANDEN in lib/vignet/config.ts, de landpagina's en de RUNBOOKS.
export const LANDEN_KENNIS: Record<string, LandKennis> = {
  at: {
    code: "at",
    naam: "Oostenrijk",
    operatorNaam: "ASFINAG",
    operatorUrl: "https://shop.asfinag.at",
    checkUrl: "https://evidenz.asfinag.at",
    feiten: [
      "Producten: 1 dag, 10 dagen, 2 maanden en jaarvignet.",
      "Het 1-daags en 10-daags vignet zijn direct geldig, ook als de klant vandaag als ingangsdatum kiest.",
      "Het 2-maanden en het jaarvignet starten door het herroepingsrecht minimaal 18 dagen na aankoop. Dat is een wettelijke regel die ASFINAG hanteert, geen keuze van ons. Wie eerder vertrekt kiest het 10-daags vignet.",
      "Maximaal 30 dagen vooruit boeken.",
      "Kentekencorrectie kan zolang wij nog niet hebben ingekocht: de klant doet dat zelf via de knop op de statuspagina. Daarna staat het kenteken in principe vast.",
      "Een aanhanger of caravan achter een personenauto heeft in Oostenrijk geen eigen vignet nodig, zolang het geheel onder 3,5 ton blijft.",
      "Sommige trajecten vallen buiten het vignet en kennen aparte trajecttol: de Brenner (A13), de Tauern, de Karawanken, de Arlberg en de Pyhrn. Die betaalt de klant zelf bij de tolpoort of vooraf online bij de tolbeheerder.",
      "Voor voertuigen boven 3,5 ton, zoals een zware camper, geldt in Oostenrijk een kilometerheffing via de GO-Box. Dat product leveren wij niet.",
    ],
  },
  ch: {
    code: "ch",
    naam: "Zwitserland",
    operatorNaam: "BAZG (via.admin.ch)",
    operatorUrl: "https://via.admin.ch/shop/",
    checkUrl: "https://via.admin.ch/shop/enquiry/evignette",
    feiten: [
      "Er is maar een Zwitsers vignet: het jaarvignet. Er bestaat geen dag-, week- of maandvariant, ook niet voor een korte doorreis.",
      "Het vignet voor 2026 is geldig van 1 december 2025 tot en met 31 januari 2027.",
      "Het Zwitserse vignet is direct geldig bij aankoop, daarom registreren wij het op de door de klant gekozen ingangsdatum. Kiest de klant vandaag, dan registreren wij direct na de bestelling.",
      "Maximaal 60 dagen vooruit boeken.",
      "Een kenteken is bij Zwitserland maar een keer te corrigeren, en alleen binnen 24 uur na registratie, dus dubbel controleren. Daarna is alleen een formele aanvraag bij BAZG mogelijk, zonder garantie.",
      "Een aanhanger of caravan heeft in Zwitserland een EIGEN tweede vignet nodig, op het eigen kenteken. De klant bestelt er dan twee.",
      "Ziet de klant zijn vignet niet in de publieke controle van via.admin.ch, dan hoeft er niets mis te zijn: die controle werkt alleen als bij de aankoop is aangevinkt dat het vignet publiek zichtbaar is.",
      "De losse alpentunnels Munt-la-Schera en Grote Sint-Bernhard vallen buiten het vignet en kennen eigen tol. De Gotthard en de San Bernardino zitten wel gewoon in het jaarvignet.",
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
      "Het jaarvignet volgt geen kalenderjaar: het loopt 365 dagen vanaf de gekozen startdatum.",
      "Maximaal 30 dagen vooruit boeken.",
      "Een typefout in het kenteken kost bij Tsjechie na de inkoop een betaalde en trage procedure bij het portaal, dus controleer het kenteken goed voor inkoop. In de praktijk is corrigeren alleen mogelijk voordat wij inkopen.",
      "Motoren zijn in Tsjechie vrijgesteld van de vignetplicht, daarom bieden wij daar geen motorvignet aan.",
      "Voertuigen op CNG of LPG en bepaalde hybrides krijgen bij het officiele portaal een lager tarief. Wij kiezen het juiste tarief op basis van de voertuiggegevens.",
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
      "Het vignet van 365 dagen loopt een vol jaar vanaf de startdatum en volgt geen kalenderjaar.",
      "Maximaal 60 dagen vooruit boeken.",
      "Een kentekencorrectie kan bij Slowakije alleen voor de eerste geldigheidsdag of binnen 15 minuten na aankoop. In de praktijk dus alleen voordat wij inkopen.",
      "Een vignet is alleen nodig op de snelwegen (D) en autowegen (R). Wie alleen over gewone stads- of doorgaande wegen rijdt, bijvoorbeeld dwars door Bratislava, heeft geen vignet nodig.",
      "Motoren zijn in Slowakije vrijgesteld van de vignetplicht.",
    ],
  },
  ro: {
    code: "ro",
    naam: "Roemenie",
    operatorNaam: "CNAIR (erovinieta.ro)",
    operatorUrl: "https://www.erovinieta.ro",
    checkUrl: "https://www.erovinieta.ro",
    feiten: [
      "Producten: 1 dag, 10 dagen, 30 dagen, 60 dagen en 12 maanden (rovinieta).",
      "Alle Roemeense vignetten zijn direct geldig na registratie.",
      "Maximaal 30 dagen vooruit boeken.",
      "Roemenie registreert het vignet op kenteken EN op chassisnummer (serie sasiu), dus beide moeten kloppen. Het chassisnummer staat op deel I van het kentekenbewijs.",
      "De officiele controle op erovinieta.ro werkt alleen met kenteken en chassisnummer samen.",
      "Een kentekenfout is bij Roemenie na uitgifte nog maar 60 minuten kosteloos te herstellen. Daarna loopt een schriftelijke procedure bij CNAIR van maximaal 5 werkdagen, zonder garantie.",
      "Omdat dat venster zo kort is, kopen wij Roemeense bestellingen snel na de betaling in.",
      "De rovinieta geldt op de snelwegen en op vrijwel alle nationale wegen. Lokale en provinciale wegen zijn vignetvrij.",
      "De tol voor de Donaubruggen bij Fetesti Cernavoda en Giurgeni Vadu Oii zit NIET in de rovinieta. Die betaalt de klant ter plaatse of online.",
      "Categorie en looptijd zijn na uitgifte niet meer te wijzigen.",
      "Motoren zijn in Roemenie vrijgesteld van de vignetplicht.",
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
      "Het weekendvignet is een vast venster van vrijdag 12:00 tot zondag 23:59, ongeacht de gekozen startdatum. Wie eerder vertrekt of later terugrijdt kiest beter het weekvignet.",
      "De overige Bulgaarse vignetten zijn direct geldig na registratie.",
      "Maximaal 30 dagen vooruit boeken, behalve het weekendvignet met zijn vaste venster.",
      "Bij Bulgarije is een kenteken na inkoop alleen te corrigeren als er hoogstens 3 tekens fout staan, via een gevolmachtigde bij het portaal. Meer dan 3 tekens fout betekent een nieuw vignet.",
      "Een correctie kan alleen als er in Bulgarije geen ander voertuig onder het foute kenteken geregistreerd staat. Tot de correctie rond is, geldt de tol als onbetaald.",
      "De geldigheidsperiode van een Bulgaars vignet is niet te wijzigen.",
      "Neem het kenteken exact over zoals op het bord: 0 (nul) en O (letter) zijn niet uitwisselbaar.",
      "Een aanhanger of caravan heeft alleen een eigen vignet nodig als auto en aanhanger samen boven 3,5 ton komen. In dat geval regelen wij beide vignetten, de klant mag daarvoor mailen.",
      "Motoren zijn in Bulgarije vrijgesteld van de vignetplicht.",
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
  "VignetteHub is een onafhankelijke bestelservice. Wij zijn geen overheid, geen toloperator en geen officieel portaal, en wij zijn niet verbonden aan ASFINAG, BAZG, edalnice.gov.cz, eznamka.sk, CNAIR of BG Toll. Wij bestellen namens de klant bij het officiele portaal van het betreffende land en rekenen daar transparante servicekosten voor. Elk vignet dat wij aanbieden kan de klant ook zelf rechtstreeks bij het portaal kopen.",
  "Wij kopen in naam van de klant en voor rekening van de klant in. De registratie staat op zijn kenteken.",
  "Een digitaal vignet is gekoppeld aan het kenteken. Er is geen sticker en geen QR-code die op de auto moet: de handhaving gebeurt met camera's die het kenteken lezen. De klant hoeft dus niets op de ruit te plakken en onderweg niets te tonen.",
  "Het vignet hoort bij het voertuig, niet bij de bestuurder. Iedereen mag met die auto rijden.",
  "Omdat het vignet aan het kenteken hangt, krijgt de klant geen fysiek bewijs of QR-sticker. Wij sturen wel een eigen bewijs-PDF zodra het vignet geregistreerd en geleverd is; die staat ook op de statuspagina. Printen hoeft niet, bewaren is handig.",
  "Wij bedienen zes landen: Oostenrijk, Zwitserland, Tsjechie, Slowakije, Roemenie en Bulgarije.",
  "Er bestaat geen gecombineerd Europees vignet. Elk tolplichtig land op de route vraagt een eigen vignet, dus voor meerdere landen plaatst de klant meerdere bestellingen.",
  "Voor Duitsland is geen vignet nodig: de snelwegen zijn daar voor personenauto's tolvrij. Italie en Kroatie werken met tolpoorten waar per traject betaald wordt, dus ook daar geen vignet.",
  "Levering duurt normaal ongeveer een kwartier nadat wij een order oppakken. Beloof nooit een exacte tijd, zeg dat het meestal snel klaar is en dat de klant een mail met bewijs krijgt zodra het geregistreerd is. Genoemde levertijden zijn een realistische indicatie, geen garantie.",
  "Wij helpen het snelst per e-mail. Op werkdagen reageren wij meestal binnen een paar uur en uiterlijk binnen een werkdag. Wij bellen nooit ongevraagd en vragen nooit per e-mail om volledige betaalgegevens.",
];

// Prijzen en bedragen: de enige plek waar de bot over geld mag praten is de
// feitenset van de bestelling zelf.
export const PRIJS_KENNIS: string[] = [
  "Noem tegenover de klant alleen het totaalbedrag uit de feitenset, nooit de splitsing tussen het officiele tarief en de servicekosten en nooit een los servicebedrag.",
  "Staat er geen bedrag in de feitenset, noem dan GEEN enkel bedrag: geen prijs, geen tarief, geen boetebedrag, ook niet bij benadering. Zeg dat de klant de totaalprijs op vignettehub.com ziet zodra hij land, product en startdatum kiest, nog voordat hij betaalt.",
  "De getoonde prijs is een totaalprijs: het officiele vignet, de registratie en de levering zitten erin. Er komen geen kosten bij tijdens het betalen.",
  "De prijs verschilt per land en per looptijd.",
  "Bedragen zijn in euro en inclusief btw. Bij een Pools kenteken rekent de klant af in zloty, met het bedrag in euro ernaast ter vergelijking.",
];

export const BESTELLEN_KENNIS: string[] = [
  "Wij hebben nodig: het land van registratie, het kenteken, het e-mailadres en voor de meeste vignetten een startdatum. Voor Roemenie ook het chassisnummer.",
  "De klant hoeft geen account te maken, sluit geen abonnement af en betaalt eenmalig per bestelling.",
  "Betalen kan met iDEAL, Bancontact, creditcard (Visa of Mastercard), PayPal en Apple Pay. Welke lokale bankmethode zichtbaar is hangt af van het land van het kenteken. Betalen met creditcard gaat via kaartvelden in het bestelscherm zelf, inloggen bij PayPal is niet nodig.",
  "De betaling loopt via de beveiligde betaalpagina van onze betaaldienstverlener. Wij zien en bewaren zelf geen kaartgegevens.",
  "Direct na de betaling krijgt de klant een bevestiging per e-mail met het betaalde bedrag, het ordernummer, het gekozen vignet en het kenteken, plus een knop naar zijn eigen statuspagina.",
  "Wij starten de uitvoering pas nadat de betaling bevestigd is.",
  "Voor een startdatum vandaag geldt een uiterste tijd, in Nederlandse tijd: tot 22:00 gewoon, tussen 22:00 en 23:30 alleen als spoedbestelling met toeslag, en vanaf 23:30 kan vandaag niet meer worden gekozen. Voor Zwitserland gelden die avondtijden niet.",
  "Een spoedtoeslag bestaat alleen in dat late avondvenster en staat dan apart in het besteloverzicht, dus de klant ziet het voor het betalen. Overdag wordt spoed niet aangeboden en niet gerekend.",
  "Bestellen en alle uitleg kan in het Nederlands, Duits, Frans en Engels. Wij antwoorden in dezelfde taal als de klant schrijft.",
];

export const NA_BESTELLING_KENNIS: string[] = [
  "Een bestelling loopt via de wachtrij of een geplande datum, dan de registratie bij het officiele portaal, dan de levering. Een bestelling kan ook geannuleerd of terugbetaald zijn.",
  "Op de statuspagina ziet de klant drie stappen: bestelling ontvangen, geregistreerd bij het officiele portaal en digitaal vignet geleverd. Staat er dat de bestelling in de wachtrij staat, dan is dat gewoon de normale gang van zaken en geen probleem.",
  "Zodra de registratie klaar is, krijgt de klant een tweede mail dat zijn vignet actief is op het kenteken, met het bewijs als bijlage en de link naar de officiele kentekencheck van dat land.",
  "Na levering kan de klant het bewijs als PDF downloaden op zijn statuspagina. Daarvoor werkt die download nog niet, want er is dan nog geen bewijs.",
  "Op het bewijs staan kenteken, land, product, startdatum, ordernummer en waar bekend de officiele referentie, plus een QR-code naar de eigen statuspagina. Er staan geen prijzen en geen betaalgegevens op.",
  "De klant kan zijn bevestigingsmail zelf opnieuw laten sturen met een knop op de statuspagina.",
  "De statuslink is persoonlijk en geheim en staat alleen in de eigen e-mails van de klant. Werkt de link niet meer, dan gebruikt de klant de link uit zijn bevestigingsmail.",
  "De klant kan zijn vignet altijd zelf gratis controleren bij het officiele portaal van het land, zo vaak als hij wil. De link staat in de leveringsmail en hieronder per land.",
  "De bevestiging per e-mail geldt als betaalbewijs. Wil de klant een factuur op naam of op bedrijfsnaam, dan sturen wij die op verzoek na.",
];

export const KENTEKEN_KENNIS: string[] = [
  "Zolang wij een bestelling nog niet hebben ingekocht, kan de klant het kenteken zelf gratis corrigeren via de knop op zijn statuspagina. Bij Roemenie corrigeert hij kenteken en chassisnummer samen.",
  "Na een geslaagde correctie krijgt de klant een aparte mail met het nieuwe kenteken.",
  "Zodra het vignet bij het portaal geregistreerd is, staat het kenteken definitief vast en kan de klant het niet meer zelf wijzigen. Wat er dan nog kan verschilt per land; wij kijken mee, maar het portaal beslist en wij kunnen geen uitkomst beloven.",
  "Een vignet met een verkeerd kenteken is niet geldig: de camera's herkennen de eigen plaat niet, dus het voertuig geldt als onbetaald ook al is er betaald. Merkt de klant een fout, dan moet hij meteen mailen.",
  "De meest gemaakte fouten: het cijfer 0 tegenover de letter O, de 1 tegenover de I, de 5 tegenover de S, een streepje of spatie te veel of te weinig, en de landcode die per ongeluk in het kentekenveld terechtkomt.",
  "Streepjes en spaties maken bij ons niets uit, alleen de letters en cijfers tellen. Umlauten verwerken wij als de gewone letter, want zo accepteren de portalen ze.",
  "Het land van registratie hoort bij het kenteken, niet bij de taal van de klant. Een Duitstalige klant kan prima een Oostenrijks kenteken hebben. De portalen vragen dat land altijd, daarom leggen wij het per bestelling vast.",
  "Wil de klant de startdatum of de looptijd wijzigen en hebben wij nog niet ingekocht, dan annuleren wij de bestelling en bestelt hij opnieuw met de juiste gegevens. Na de inkoop staat de looptijd vast.",
];

export const VOERTUIG_KENNIS: string[] = [
  "Wij regelen vignetten voor personenauto's en campers tot 3,5 ton toegestane maximummassa. Dat gewicht staat op het kentekenbewijs bij veld F.",
  "Motorvignetten verkopen wij op dit moment niet. In Tsjechie, Slowakije, Roemenie en Bulgarije zijn motoren sowieso vrijgesteld. Voor Oostenrijk of Zwitserland verwijzen wij de klant naar het officiele portaal.",
  "Voor voertuigen zwaarder dan 3,5 ton geldt in Oostenrijk een kilometerheffing via de GO-Box. Dat leveren wij niet.",
  "Een aanhanger of caravan valt in Oostenrijk, Tsjechie, Slowakije, Roemenie en Bulgarije onder het vignet van de auto zolang het geheel onder 3,5 ton blijft. Zwitserland is de uitzondering: daar heeft de aanhanger een eigen vignet nodig.",
];

export const NIET_AANBOD_KENNIS: string[] = [
  "Slovenie verkopen wij niet: daar mag alleen DARS en zijn officiele verkooppunten verkopen. Wij leggen de klant gratis uit hoe hij de e-vinjeta in een paar minuten zelf regelt bij DARS.",
  "Hongarije verkopen wij niet: daar mag een tussenpersoon wettelijk geen servicekosten doorberekenen. Wij leggen gratis uit hoe de klant de e-matrica zelf regelt.",
  "Trajecttol en tunneltol verkopen wij niet. Die betaalt de klant bij de tolpoort of vooraf online bij de tolbeheerder.",
];

// De annuleerregel, exact volgens spec sectie 6 en de algemene voorwaarden.
// Dit is de enige regel over geld.
export const ANNULEER_REGEL: string[] = [
  "Annuleren voor inkoop: zolang wij het vignet nog niet hebben ingekocht, kan de klant kosteloos annuleren en krijgt hij alles terug. Annuleren gaat per e-mail met het ordernummer erbij; er staat GEEN annuleerknop op de statuspagina, dus verwijs de klant daar nooit naar. Wij zetten de bestelling stop en betalen het volledige bedrag terug.",
  "Terugbetalen gaat altijd via dezelfde betaalmethode waarmee de klant betaald heeft, doorgaans binnen 1 tot 3 werkdagen en uiterlijk binnen 14 dagen. De klant krijgt daarvan een aparte bevestiging per mail.",
  "Annuleren na inkoop: is het vignet eenmaal ingekocht, dan staat het geregistreerd op het kenteken van de klant en kunnen wij het niet terugdraaien. Een eventuele annulering of restitutie loopt dan bij de operator zelf.",
  "Beloof bij een annulering na inkoop nooit een uitkomst. Zeg niet dat de operator het terugbetaalt, maar dat de operator daarover beslist. Geef de klant de naam en de link van het juiste portaal mee.",
  "Bij het bestellen geeft de klant twee akkoorden: opdracht om het vignet namens hem te registreren, en het verzoek om direct met de uitvoering te beginnen waarbij het herroepingsrecht vervalt zodra het vignet geregistreerd is. Daarom is herroepen na registratie wettelijk niet meer mogelijk. Tot dat moment kan de klant altijd kosteloos annuleren.",
  "Lukt de registratie onverhoopt niet, dan brengen wij het in orde of betalen wij het volledige bedrag terug.",
];

// ---------------------------------------------------------------------------

/**
 * Bouwt het kennisblok voor de systeemprompt. Is het land bekend, dan krijgt
 * dat land voorrang en laten we de andere landen weg om het model te focussen
 * en tokens te sparen. Is het land onbekend, dan komen alle zes de landen mee:
 * bij een algemene vraag zonder bestelling is dat juist wat de bot nodig heeft.
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

  const sectie = (kop: string, regels: string[]) => [kop, ...regels.map((r) => `- ${r}`), ""];

  return [
    "KENNISBANK (gebruik alleen wat hier staat, verzin niets):",
    "",
    ...sectie("Algemeen:", ALGEMENE_KENNIS),
    ...sectie("Prijzen en bedragen:", PRIJS_KENNIS),
    ...sectie("Bestellen en betalen:", BESTELLEN_KENNIS),
    ...sectie("Na de bestelling, status en bewijs:", NA_BESTELLING_KENNIS),
    ...sectie("Kenteken en wijzigen:", KENTEKEN_KENNIS),
    ...sectie("Voertuigen:", VOERTUIG_KENNIS),
    ...sectie("Wat wij niet leveren:", NIET_AANBOD_KENNIS),
    ...sectie("Annuleren en terugbetalen:", ANNULEER_REGEL),
    gekozen ? `Land van deze bestelling:` : "Landen die wij bedienen:",
    ...landRegels,
  ].join("\n");
}
