// Controlelaag (spec sectie 8). Draait op ELK concept voordat het de deur uit
// mag. Afkeuren betekent altijd: niet versturen, wel escaleren met het
// afgekeurde concept erbij. De controle staat los van het model: het model kan
// hier niets aan veranderen.
//
// Drie controles uit de spec:
//   a) elk bedrag in het antwoord moet letterlijk voorkomen in de toegestane
//      bedragen uit de feitenset, anders afkeuren,
//   b) geen en-dash of em-dash, en geen zin uit de robotcopy-verbodslijst,
//   c) de taal van het antwoord moet overeenkomen met de gedetecteerde taal
//      van de klant.
//
// Twee eigen controles, gekozen op risico:
//   d) geen lek van interne velden en geen verboden merknaam (Taxionspot),
//   e) geen leeg concept en geen achtergebleven "dit weet ik niet"-sentinel,
//      zodat we nooit een blanco of half antwoord versturen.

import { centenUitTekst, bouwFeitenBlok, alsObject, leesTekst } from "./feiten.js";
import { isTaal, type BotTaal } from "./prompts/classificatie.js";
import { NIET_WETEN_SENTINEL } from "./prompts/opstellen.js";
import type {
  Concept,
  OpstelInvoer,
  ControleResultaat,
  ControleProbleem,
  ControleCode,
} from "./types.js";

// Resultaat van de losse kerncontrole. Eigen vorm met een interne code, los van
// het contracttype ControleResultaat dat controleerConcept naar de lus teruggeeft.
interface KernResultaat {
  ok: boolean;
  reden?: string;
  /** Interne code, wordt in controleerConcept op een ControleCode afgebeeld. */
  code?: string;
}

function afkeuren(code: string, reden: string): KernResultaat {
  return { ok: false, code, reden };
}

const GOEDGEKEURD: KernResultaat = { ok: true };

/** Kleine letters plus diacritische tekens eraf, zodat een robotzin ook met
 * accenten (elnezest, e in fase) herkend wordt. */
const COMBINEER_TEKENS = new RegExp("[\\u0300-\\u036f]", "g");
function ontdiakritiseer(tekst: string): string {
  return tekst.toLowerCase().normalize("NFD").replace(COMBINEER_TEKENS, "");
}

// ---------------------------------------------------------------------------
// (b) Streepjes en robotcopy.

// en-dash, em-dash, figure dash, horizontal bar. Gewoon streepje (-) is toegestaan.
const VERBODEN_STREEPJES = /[‒–—―]/;

// Robotzinnen. Spec noemt de eerste drie; de rest komt uit de huisregels
// (feedback_no_ai_copy en feedback_annuleren_work_done_framing). De controle
// draait op de ge-ontdiakritiseerde tekst, dus de zinnen staan hier zonder
// accenten (elnezest, e in fase), zodat ook de accentvariant matcht.
//
// ROBOT_KERN geldt in ELKE taal: de AI-onthulling mag nooit voorkomen.
const ROBOT_KERN = [
  "als ai",
  "als een ai",
  "as an ai",
  "as a language model",
  "als ki",
  "als eine ki",
  "come ia",
  "in quanto ia",
  "en tant qu'ia",
  "en tant qu ia",
  "jako ai",
  "como una ia",
  "como ia",
  "bir yapay zeka olarak",
  "ca inteligenta artificiala",
  "mint mesterseges intelligencia",
];

// Verboden servicezinnen per taal: de "in behandeling / wij streven"-familie en
// de excuus- en waarderingsformules. Zo wordt de huisregel in alle 11 talen
// afgedwongen, niet alleen in het Nederlands.
const ROBOT_PER_TAAL: Record<BotTaal, string[]> = {
  nl: [
    "wij streven ernaar",
    "we streven ernaar",
    "uw verzoek is in behandeling",
    "uw aanvraag is in behandeling",
    "uw bericht is in behandeling",
    "ik begrijp uw frustratie",
    "wij begrijpen uw frustratie",
    "wij hechten veel waarde aan",
    "wij waarderen uw geduld",
    "excuses voor het ongemak",
  ],
  de: [
    "ihre anfrage wird bearbeitet",
    "ihr anliegen wird bearbeitet",
    "wir sind bestrebt",
    "wir bitten um ihr verstandnis",
    "wir entschuldigen uns fur die unannehmlichkeiten",
    "wir schatzen ihre geduld",
  ],
  fr: [
    "votre demande est en cours de traitement",
    "nous nous efforcons",
    "nous vous prions de nous excuser pour la gene",
    "nous apprecions votre patience",
  ],
  en: [
    "your request is being processed",
    "your request is currently being processed",
    "we strive to",
    "we apologize for any inconvenience",
    "we appreciate your patience",
    "we value your",
  ],
  pl: [
    "twoje zgloszenie jest przetwarzane",
    "panstwa zgloszenie jest rozpatrywane",
    "dokladamy wszelkich staran",
    "przepraszamy za niedogodnosci",
  ],
  it: [
    "la sua richiesta e in fase di elaborazione",
    "in fase di elaborazione",
    "ci scusiamo per il disagio",
    "ci impegniamo a",
    "apprezziamo la sua pazienza",
  ],
  ro: [
    "cererea dumneavoastra este in curs de procesare",
    "solicitarea dumneavoastra este in curs",
    "ne cerem scuze pentru neplacere",
    "va multumim pentru rabdare",
  ],
  cs: [
    "vase zadost se zpracovava",
    "vasi zadost zpracovavame",
    "omlouvame se za neprijemnosti",
    "dekujeme za trpelivost",
  ],
  hu: [
    "a kerelmet feldolgozzuk",
    "kerelmet feldolgozas alatt",
    "elnezest kerunk a kellemetlensegert",
    "koszonjuk a turelmet",
  ],
  es: [
    "su solicitud esta en tramite",
    "estamos procesando su solicitud",
    "lamentamos las molestias",
    "agradecemos su paciencia",
    "nos esforzamos por",
  ],
  tr: [
    "talebiniz isleme alinmistir",
    "talebiniz islemdedir",
    "verdigimiz rahatsizliktan dolayi ozur",
    "sabriniz icin tesekkur",
  ],
};

// ---------------------------------------------------------------------------
// (d) Interne velden en merknaam.

// Ruwe veldnamen of technische identifiers die nooit in een klantmail horen.
const INTERNE_TERMEN = [
  "officieelcents",
  "servicecents",
  "spoedcents",
  "proofnote",
  "captureid",
  "paypalorderid",
  "refundtotaal",
  "refundinflight",
  "payernaam",
  "payeradres",
  "payeremail",
  "statustoken",
  "vinmailid",
  "gclid",
  "wbraid",
  "gbraid",
];

// Verboden merknamen: klant-facing alleen VignetteHub.
const VERBODEN_MERKEN = ["taxionspot"];

// ---------------------------------------------------------------------------
// (a) Bedragen.

// Valutatokens die een getal tot een bedrag maken. Alleen een getal naast zo'n
// token telt als bedrag; losse getallen (18 dagen, 60 minuten, 2027) niet.
// Alle valuta van de verkochte markten plus veelvoorkomende symbolen. Bewust
// ruim: wij prijzen alleen in EUR en PLN, dus een getal naast CHF, Kc, Ft, TL,
// pond of dollar is per definitie een verzonnen bedrag en hoort afgekeurd te
// worden. De tokens staan strak op woordgrenzen zodat "fr"/"ft"/"tl" geen ruis
// geven, en ze tellen alleen als er een getal naast staat.
const VALUTA_TOKEN =
  "(?:€|£|\\$|eur\\b|euro'?s?\\b|pln\\b|z[łl]\\b|z[łl]oty\\b|lei\\b|ron\\b|лв|chf\\b|fr(?:\\.|anken|s)?\\b|k[čc]\\b|korun\\w*\\b|ft\\b|forint\\w*\\b|huf\\b|tl\\b|lir\\w*\\b|try\\b|gbp\\b|pond\\w*\\b|usd\\b|dollar\\w*\\b)";
const GETAL = "\\d[\\d.,]*\\d|\\d";
const BEDRAG_VOOR = new RegExp(`${VALUTA_TOKEN}\\s*(${GETAL})`, "gi");
const BEDRAG_NA = new RegExp(`(${GETAL})\\s*${VALUTA_TOKEN}`, "gi");

/** Alle bedragen (in centen) die als bedrag in de tekst staan. */
export function bedragenInTekst(tekst: string): number[] {
  const gevonden = new Set<number>();
  for (const regex of [BEDRAG_VOOR, BEDRAG_NA]) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(tekst)) !== null) {
      const cents = centenUitTekst(m[1]);
      if (cents != null) gevonden.add(cents);
    }
  }
  return [...gevonden];
}

// ---------------------------------------------------------------------------
// (c) Taaldetectie. Bewust conservatief: alleen afkeuren bij een duidelijke
// mismatch, bij twijfel goedkeuren, zodat we geen goede antwoorden tegenhouden.

const STOPWOORDEN: Record<BotTaal, string[]> = {
  nl: ["de", "het", "een", "en", "uw", "wij", "is", "niet", "voor", "met", "dat", "wordt", "bestelling", "kenteken"],
  de: ["der", "die", "das", "und", "ist", "nicht", "sie", "ihre", "wir", "für", "mit", "wird", "eine", "kennzeichen"],
  fr: ["le", "la", "les", "une", "et", "vous", "votre", "nous", "est", "pas", "pour", "avec", "commande", "merci"],
  en: ["the", "and", "your", "we", "for", "with", "order", "will", "please", "that", "have", "been", "registered"],
  pl: ["nie", "jest", "twoje", "dla", "oraz", "pojazd", "zamówienie", "państwa", "się", "dziękujemy", "prosimy"],
  it: ["il", "le", "non", "per", "con", "sua", "ordine", "veicolo", "grazie", "targa", "della", "abbiamo"],
  ro: ["nu", "este", "dumneavoastra", "dumneavoastră", "pentru", "comanda", "vehicul", "și", "vă", "mulțumim"],
  cs: ["ne", "je", "pro", "vaše", "objednávka", "vozidlo", "děkujeme", "prosím", "byla", "registrována"],
  hu: ["nem", "van", "az", "egy", "és", "köszönjük", "rendszám", "rendelés", "kérjük", "jármű"],
  es: ["el", "los", "no", "es", "para", "con", "su", "pedido", "gracias", "vehículo", "hemos", "matrícula"],
  tr: ["değil", "için", "siz", "sizin", "araç", "sipariş", "teşekkür", "plaka", "ve", "kaydedildi"],
};

// Diacritische signalen per taal. Aanwezigheid weegt zwaar want ze zijn distinctief.
const DIACRITISCH: Partial<Record<BotTaal, RegExp>> = {
  pl: /[łżśćńąęźó]/i,
  cs: /[řěčšžůďťňá]/i,
  ro: /[ăâîșțş]/i,
  hu: /[őűáéíóöúü]/i,
  tr: /[ışğİıçö]/i,
  es: /[ñ¿¡]/i,
  fr: /[çàèêâû]/i,
  de: /[äöüß]/i,
};

function scoorTaal(woorden: string[], tekst: string, taal: BotTaal): number {
  const set = new Set(STOPWOORDEN[taal]);
  let score = 0;
  for (const w of woorden) if (set.has(w)) score += 1;
  const dia = DIACRITISCH[taal];
  if (dia && dia.test(tekst)) score += 2;
  return score;
}

/**
 * Detecteert of de tekst duidelijk in een ANDERE taal dan de doeltaal staat.
 * Geeft de best passende taal en de scores terug. Conservatief: alleen bij een
 * duidelijk verschil spreken we van een mismatch.
 */
export function taalMismatch(tekst: string, doel: BotTaal): { mismatch: boolean; gedetecteerd: BotTaal } {
  const woorden = tekst
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  // Te weinig woorden om betrouwbaar te oordelen: nooit afkeuren op taal.
  if (woorden.length < 4) return { mismatch: false, gedetecteerd: doel };

  const talen = Object.keys(STOPWOORDEN) as BotTaal[];
  let besteTaal: BotTaal = doel;
  let besteScore = -1;
  for (const t of talen) {
    const s = scoorTaal(woorden, tekst, t);
    if (s > besteScore) {
      besteScore = s;
      besteTaal = t;
    }
  }
  const doelScore = scoorTaal(woorden, tekst, doel);

  // Duidelijke mismatch: een andere taal scoort merkbaar hoger en de doeltaal
  // vindt vrijwel geen houvast. Anders goedkeuren.
  const duidelijkAnders = besteTaal !== doel && besteScore >= 3 && besteScore >= doelScore + 3 && doelScore <= 1;
  return { mismatch: duidelijkAnders, gedetecteerd: besteTaal };
}

// ---------------------------------------------------------------------------
// Kern.

export interface ConceptControle {
  tekst: string;
  taal: BotTaal;
}

/**
 * Voert de vijf controles uit op een concrete tekst plus de toegestane
 * bedragen. Volledig testbaar zonder netwerk.
 */
export function controleerConceptKern(concept: ConceptControle, bedragenCents: number[]): KernResultaat {
  const tekst = (concept.tekst ?? "").trim();
  const laag = tekst.toLowerCase();
  // Voor de robotzin-match: accenten eraf, zodat de accentvariant ook pakt.
  const plat = ontdiakritiseer(tekst);

  // (e) leeg of sentinel: nooit versturen.
  if (tekst.length < 10) {
    return afkeuren("leeg_concept", "het concept is leeg of te kort om te versturen");
  }
  if (laag.includes(NIET_WETEN_SENTINEL)) {
    return afkeuren("weet_niet", "het concept bevat het niet-weten-signaal");
  }

  // (b) streepjes en robotcopy. De AI-onthulling geldt in elke taal, de
  // servicezinnen per taal van het concept.
  if (VERBODEN_STREEPJES.test(tekst)) {
    return afkeuren("streepje", "het concept bevat een en-dash of em-dash");
  }
  const robotZinnen = [...ROBOT_KERN, ...(ROBOT_PER_TAAL[concept.taal] ?? [])];
  for (const zin of robotZinnen) {
    if (plat.includes(zin)) {
      return afkeuren("robotcopy", `het concept bevat de verboden zin '${zin}'`);
    }
  }

  // (d) interne velden en merknaam.
  for (const merk of VERBODEN_MERKEN) {
    if (laag.includes(merk)) {
      return afkeuren("merk_lek", `het concept noemt een verboden merknaam '${merk}'`);
    }
  }
  for (const term of INTERNE_TERMEN) {
    if (laag.includes(term)) {
      return afkeuren("intern_lek", `het concept bevat het interne veld '${term}'`);
    }
  }

  // (a) bedragen: elk bedrag in de tekst moet in de toegestane lijst staan.
  const toegestaan = new Set(bedragenCents.map((c) => Math.round(c)));
  for (const cents of bedragenInTekst(tekst)) {
    if (!toegestaan.has(cents)) {
      return afkeuren(
        "bedrag_niet_toegestaan",
        `het concept noemt een bedrag (${(cents / 100).toFixed(2)}) dat niet in de feitenset staat`,
      );
    }
  }

  // (c) taal.
  const { mismatch, gedetecteerd } = taalMismatch(tekst, concept.taal);
  if (mismatch) {
    return afkeuren(
      "taal_mismatch",
      `het antwoord lijkt in het ${gedetecteerd} geschreven, verwacht was ${concept.taal}`,
    );
  }

  return GOEDGEKEURD;
}

// ---------------------------------------------------------------------------
// Contractfunctie uit types.ts.

// Interne kerncode naar de ControleCode-enum van het contract.
function naarControleCode(intern?: string): ControleCode {
  switch (intern) {
    case "leeg_concept":
    case "weet_niet":
      return "leeg";
    case "streepje":
      return "streepje";
    case "robotcopy":
      return "robotzin";
    case "merk_lek":
      return "verboden_merknaam";
    case "intern_lek":
      return "verboden_gegeven";
    case "bedrag_niet_toegestaan":
      return "bedrag_niet_in_feiten";
    case "taal_mismatch":
      return "verkeerde_taal";
    default:
      return "leeg";
  }
}

/**
 * Contractfunctie (types.ts, ControleerConceptFn): controleer een Concept tegen
 * de feitenset uit de OpstelInvoer. Levert ControleResultaat {ok, problemen[]}.
 * Bij ok=false: niet versturen, wel escaleren.
 */
export function controleerConcept(concept: Concept, invoer: OpstelInvoer): ControleResultaat {
  const bron = alsObject(concept) ?? {};
  const tekst = leesTekst(bron, "tekst", "body", "antwoord", "antwoordTekst");
  const ruweTaal = leesTekst(bron, "taal", "locale", "language");
  const taal: BotTaal = isTaal(ruweTaal) ? ruweTaal : "en";

  const feitenBlok = bouwFeitenBlok(invoer.order);
  const resultaat = controleerConceptKern({ tekst, taal }, feitenBlok.bedragenCents);
  if (resultaat.ok) return { ok: true, problemen: [] };
  const probleem: ControleProbleem = {
    code: naarControleCode(resultaat.code),
    detail: resultaat.reden ?? "onbekende reden",
  };
  return { ok: false, problemen: [probleem] };
}
