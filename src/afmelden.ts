import { normaliseer } from "./landtekst.js";

// Afmeld- of gegevensverwijderverzoek herkennen (08-08-2026).
//
// AANLEIDING: julia.kiesshauer@gmx.de (een LEAD, geen order) schreef "Abmelden.
// Bitte entfernen Sie meine Daten. Die Vignette wird nicht benoetigt." De bot
// escaleerde dat als mens_nodig, terwijl het antwoord altijd hetzelfde is: geen
// afhakermails meer sturen en de leadgegevens weg. Dat kan de bot zelf.
//
// STRENG, want op dit signaal worden gegevens VERWIJDERD:
//   1. alleen expliciete afmeld- of verwijderformuleringen, geen los "niet
//      nodig" (dat zegt een klant ook in heel andere zinnen);
//   2. alleen bij een KORTE mail: wie een verhaal schrijft wil meestal meer, en
//      dat hoort een mens of het opstelmodel te zien;
//   3. de aanroeper controleert zelf dat er GEEN order is en dat de afzender
//      geauthenticeerd is (DMARC/DKIM); ordergegevens vallen onder de
//      bewaarplicht en een annulering is een geldbeslissing.
const AFMELD_FRASEN = [
  // los woord, zoals in een onderwerpregel
  "abmelden", "unsubscribe", "afmelden", "uitschrijven", "desabonner", "desinscrire",
  // duits
  "entfernen sie meine daten", "loschen sie meine daten", "meine daten loschen",
  "daten bitte loschen", "keine mails mehr", "keine e mails mehr", "keine werbung mehr",
  "keine weiteren e mails", "keine weiteren mails",
  // nederlands
  "verwijder mijn gegevens", "mijn gegevens verwijderen", "geen mails meer",
  "geen e mails meer", "geen berichten meer", "schrijf mij uit",
  // engels
  "delete my data", "remove my data", "remove my details", "no more emails",
  "stop emailing me", "stop sending me emails",
  // frans
  "supprimez mes donnees", "supprimer mes donnees", "plus de mails", "plus d e mails",
];

/** Ruwe lengtegrens: een afmeldverzoek is kort. */
const MAX_WOORDEN_AFMELDEN = 60;

export function isAfmeldVerzoek(tekst: string): boolean {
  const plat = normaliseer(tekst);
  if (!plat) return false;
  const woorden = plat.split(/\s+/).filter(Boolean);
  if (woorden.length === 0 || woorden.length > MAX_WOORDEN_AFMELDEN) return false;
  const omringd = ` ${plat} `;
  return AFMELD_FRASEN.some((f) => omringd.includes(` ${f} `));
}
