// Feitelijke klacht of echte juridische zaak? (besluit Sabur 04-08)
//
// Tot nu escaleerde ELKE mail met intent klacht_juridisch of betaling_probleem
// naar een mens. In de praktijk gaat het overgrote deel over dezelfde drie
// dingen, en het antwoord daarop bestaat uit vaste feiten uit de bestelling:
//   - "ik dacht dat jullie het officiele portaal waren",
//   - "de servicekosten waren niet duidelijk / het bedrag is te hoog",
//   - "ik wil mijn geld terug" terwijl het vignet al geregistreerd is.
// Die mag de bot zelf beantwoorden: erkennen, feiten geven, eerlijk zeggen wat
// wel en niet kan, en NOOIT geld toezeggen (dat blijft een mensbeslissing en
// verify.ts houdt elk ander bedrag tegen).
//
// Een ECHTE juridische zaak blijft mensenwerk. Dat is niet aan de toon te zien
// maar aan concrete signalen: een advocaat of incassobureau, een toezichthouder
// of geschillencommissie, een aangekondigde terugboeking of PayPal-kwestie, een
// dagvaarding of termijnstelling. Die herkennen we DETERMINISTISCH, niet met een
// model: bij twijfel escaleren is hier altijd het goede antwoord.
//
// De lijsten dekken de talen waarin wij post krijgen (nl, de, en, fr, it, es,
// pl, cs, hu, ro, tr). Accenten worden weggehaald voor de vergelijking, zodat
// "rétractation" en "retractation" allebei matchen.

/** Advocaat, incasso, rechtbank, toezichthouder, geschillencommissie. */
const JURIDISCH = [
  // nl
  "advocaat", "advokaat", "deurwaarder", "incassobureau", "incasso", "rechtbank", "dagvaarding",
  "juridische stappen", "rechtsbijstand", "geschillencommissie", "consumentenbond", "acm",
  "ingebrekestelling", "aansprakelijk",
  // de
  "rechtsanwalt", "anwalt", "anwaltlich", "inkassobuero", "inkasso", "gericht", "klage",
  "mahnbescheid", "verbraucherzentrale", "rechtsschutz", "schadensersatz", "in verzug",
  "fristsetzung", "unterlassung", "abmahnung", "strafanzeige", "anzeige erstatten",
  // en
  "lawyer", "attorney", "solicitor", "legal action", "legal steps", "court", "small claims",
  "trading standards", "consumer protection", "debt collection", "ombudsman", "cease and desist",
  // fr
  "avocat", "huissier", "tribunal", "mise en demeure", "action en justice", "recouvrement",
  "protection des consommateurs", "mediateur",
  // it / es
  "avvocato", "tribunale", "diffida", "recupero crediti", "abogado", "juzgado", "demanda",
  "requerimiento", "consumo",
  // pl / cs / hu / ro / tr
  "adwokat", "prawnik", "sad ", "windykacja", "advokat", "soud", "vymahani",
  "ugyved", "birosag", "avocat", "instanta", "somatie", "avukat", "mahkeme", "icra",
];

/** Terugboeking of betaalconflict via bank, kaart of PayPal. */
const TERUGBOEKING = [
  "chargeback", "charge back", "terugboeking", "terugboeken", "storneren", "storno",
  // Op de STAM matchen, niet op een enkele vorm: klanten schrijven zowel
  // "Rueckbuchung" als "zurueckbuchen lassen", en sommige mailprogramma's maken
  // van de umlaut "ue" en andere laten hem staan (die valt weg bij normaliseren).
  "ruckbuch", "rueckbuch", "lastschrift zuruck", "zahlung zuruck",
  "paypal kaufer", "paypal-kaufer", "kauferschutz", "kaeuferschutz", "buyer protection",
  "paypal dispute", "streitfall",
  "kwestie ingediend", "dispute", "conflit paypal", "litige", "contestazione",
  "contracargo", "retrocesion", "obciazenie zwrotne", "reklamacja platnosci",
  "banka iade", "ters ibraz",
];

/** Accenten en rare tekens weg, alles klein, spaties normaliseren. */
function normaliseer(tekst: string): string {
  return String(tekst ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bevat(plat: string, woorden: string[]): string | null {
  for (const w of woorden) {
    if (plat.includes(w)) return w.trim();
  }
  return null;
}

export interface KlachtOordeel {
  /** True = een mens moet dit doen. */
  mensNodig: boolean;
  /** Welk signaal de doorslag gaf, voor het log en de escalatietoelichting. */
  signaal: string;
}

/**
 * Beoordeelt of een klacht een echte juridische zaak is. Kijkt naar de
 * VOLLEDIGE mailtekst inclusief citaat, want een dreiging staat vaak onderaan
 * in een doorgestuurde eerdere mail.
 */
export function beoordeelKlacht(tekst: string, onderwerp = ""): KlachtOordeel {
  const plat = normaliseer(`${onderwerp} ${tekst}`);
  if (!plat) return { mensNodig: true, signaal: "lege mail" };

  const juridisch = bevat(plat, JURIDISCH);
  if (juridisch) return { mensNodig: true, signaal: `juridisch signaal "${juridisch}"` };

  const terugboeking = bevat(plat, TERUGBOEKING);
  if (terugboeking) return { mensNodig: true, signaal: `terugboeking of betaalconflict "${terugboeking}"` };

  return { mensNodig: false, signaal: "" };
}

/**
 * Mag de bot deze klacht zelf beantwoorden? Alleen als ALLE poorten open staan:
 * er is een bestelling gevonden, de afzender is aantoonbaar de besteller, het
 * afzenderadres is echt (DMARC/DKIM), en er is geen juridisch signaal.
 *
 * Bewust een pure functie met expliciete argumenten, zodat de test hem los kan
 * doorlopen zonder mailbox of database.
 */
export function magKlachtZelfBeantwoorden(invoer: {
  heeftOrder: boolean;
  identiteitKlopt: boolean;
  afzenderGeauthenticeerd: boolean;
  tekst: string;
  onderwerp?: string;
}): { mag: boolean; reden: string } {
  if (!invoer.heeftOrder) return { mag: false, reden: "geen bestelling gevonden" };
  if (!invoer.identiteitKlopt) return { mag: false, reden: "afzender is niet de besteller" };
  if (!invoer.afzenderGeauthenticeerd) return { mag: false, reden: "afzenderadres niet geauthenticeerd" };
  const oordeel = beoordeelKlacht(invoer.tekst, invoer.onderwerp ?? "");
  if (oordeel.mensNodig) return { mag: false, reden: oordeel.signaal };
  return { mag: true, reden: "" };
}
