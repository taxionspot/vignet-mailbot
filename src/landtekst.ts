// Landnaam uit een klantmail halen (05-08).
//
// Aanleiding: VH-53HNS stond met een Roemeens kenteken (AR69JFA) op Duitsland
// besteld. Het portaal weigerde het, de klant kreeg netjes de vraag om het na
// te kijken, maar noch de klant noch de bot kon het LAND corrigeren; alleen de
// plaat. Daardoor bleef zo'n order liggen tot een mens hem oppakte.
//
// Deze module leest een landnaam uit het antwoord van de klant, in de talen
// waarin wij post krijgen plus de Engelse en eigen naam van het land. Bewust
// GEEN model: dit is een korte, gesloten lijst en een fout hier kost een
// ongeldig vignet. Vindt hij er meer dan een, dan geeft hij null terug (twijfel
// is geen antwoord) en valt de bot terug op het gewone uitleg-antwoord.

// Per ISO-code de namen die klanten schrijven. Kleine letters, accentloos; de
// invoer wordt op dezelfde manier platgeslagen. Alleen landen die wij als
// registratieland aanbieden en die op een kenteken herkenbaar zijn.
const LANDNAMEN: Record<string, string[]> = {
  NL: ["nederland", "netherlands", "niederlande", "pays-bas", "paesi bassi", "holland", "olanda"],
  DE: ["duitsland", "germany", "deutschland", "allemagne", "germania", "alemania", "niemcy", "nemecko"],
  BE: ["belgie", "belgium", "belgien", "belgique", "belgio", "belgica", "belgia"],
  FR: ["frankrijk", "france", "frankreich", "francia", "francja", "francie"],
  LU: ["luxemburg", "luxembourg", "lussemburgo", "luxemburgo"],
  AT: ["oostenrijk", "austria", "osterreich", "oesterreich", "autriche", "avusturya", "rakousko"],
  CH: ["zwitserland", "switzerland", "schweiz", "suisse", "svizzera", "suiza", "szwajcaria"],
  CZ: ["tsjechie", "czech republic", "czechia", "tschechien", "republique tcheque", "cesko", "ceska republika"],
  SK: ["slowakije", "slovakia", "slowakei", "slovaquie", "slovensko", "slovacchia"],
  RO: ["roemenie", "romania", "rumanien", "rumaenien", "roumanie", "romania", "rumunia", "rumunsko"],
  BG: ["bulgarije", "bulgaria", "bulgarien", "bulgarie", "bulgaria", "bulharsko"],
  IT: ["italie", "italy", "italien", "italia", "italie", "wlochy"],
  ES: ["spanje", "spain", "spanien", "espagne", "espana", "hiszpania"],
  PL: ["polen", "poland", "pologne", "polonia", "polska"],
  HU: ["hongarije", "hungary", "ungarn", "hongrie", "magyarorszag", "ungheria"],
  GB: ["engeland", "england", "united kingdom", "great britain", "grossbritannien", "royaume-uni"],
  DK: ["denemarken", "denmark", "danemark", "danmark", "danimarca"],
  SE: ["zweden", "sweden", "schweden", "suede", "sverige", "svezia"],
  NO: ["noorwegen", "norway", "norwegen", "norvege", "norge"],
  PT: ["portugal", "portogallo", "portugalia"],
  HR: ["kroatie", "croatia", "kroatien", "croatie", "hrvatska", "croazia"],
  SI: ["slovenie", "slovenia", "slowenien", "slovenie", "slovenija"],
  RS: ["servie", "serbia", "serbien", "serbie", "srbija"],
  TR: ["turkije", "turkey", "turkei", "tuerkei", "turquie", "turkiye"],
  LT: ["litouwen", "lithuania", "litauen", "lituanie", "lietuva"],
  LV: ["letland", "latvia", "lettland", "lettonie", "latvija"],
  EE: ["estland", "estonia", "estonie", "eesti"],
  IE: ["ierland", "ireland", "irland", "irlande"],
  GR: ["griekenland", "greece", "griechenland", "grece", "ellada"],
  FI: ["finland", "finnland", "finlande", "suomi"],
  IS: ["ijsland", "iceland", "island", "islande"],
  LI: ["liechtenstein"],
  UA: ["oekraine", "ukraine", "ukrajina"],
};

/** Kleine letters, accenten weg, alleen letters en spaties over. */
function normaliseer(tekst: string): string {
  return String(tekst ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Zoekt het land dat de klant noemt. Geeft de ISO-code terug, of null als er
 * geen of juist meerdere verschillende landen in staan (dan is het antwoord
 * niet eenduidig en moet de bot niets wijzigen).
 *
 * `negeer` is bedoeld voor het land dat al op de bestelling staat: dat noemt de
 * klant vaak in de trant van "niet Duitsland maar Roemenie", en dan willen we
 * dat niet als tweede treffer tellen.
 */
export function landUitTekst(tekst: string, negeer?: string): string | null {
  const plat = ` ${normaliseer(tekst)} `;
  if (plat.trim() === "") return null;
  const gevonden = new Set<string>();
  for (const [code, namen] of Object.entries(LANDNAMEN)) {
    if (negeer && code === negeer.toUpperCase()) continue;
    for (const naam of namen) {
      if (plat.includes(` ${naam} `)) {
        gevonden.add(code);
        break;
      }
    }
  }
  if (gevonden.size !== 1) return null;
  return [...gevonden][0];
}
