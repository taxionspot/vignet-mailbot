// Vaste, deterministische klantteksten. Geen model, geen feitenset, geen
// injectie-oppervlak: dit zijn kant-en-klare zinnen per taal.
//
// Waarom niet via het model: deze teksten gaan de deur uit op momenten dat er
// juist iets NIET goed ging (de bot kan het zelf niet af, een actie mislukte).
// Dan wil je zekerheid over wat er staat, geen tweede modelaanroep die ook kan
// mislukken. Ze kosten bovendien niets.
//
// Stijlregels (huisregels Sabur): kort, menselijk, geen liggende streepjes,
// geen robotcopy zoals "uw verzoek is in behandeling" of "wij streven ernaar".

import type { BotTaal } from "./prompts/classificatie.js";

/**
 * Ontvangstbevestiging bij een escalatie. De klant weet daarmee dat zijn mail
 * is aangekomen en dat er een mens naar kijkt (besluit Sabur 24-07: niet meer
 * stil blijven tot Sabur zelf antwoordt).
 *
 * Bewust GEEN belofte over een uitkomst en geen exacte termijn per uur, wel een
 * concrete verwachting (binnen een werkdag) zodat de klant niet gaat rappelleren.
 */
export const ONTVANGST_TEKST: Record<BotTaal, string> = {
  nl: "Uw bericht is binnen en ligt bij een collega. U krijgt persoonlijk antwoord, meestal binnen een werkdag. Heeft u nog iets toe te voegen, dan kunt u gewoon op deze mail reageren.",
  de: "Ihre Nachricht ist bei uns angekommen und liegt bei einer Kollegin. Sie bekommen eine persoenliche Antwort, meist innerhalb eines Werktages. Moechten Sie noch etwas ergaenzen, antworten Sie einfach auf diese E-Mail.",
  fr: "Votre message nous est bien parvenu et un collegue s'en occupe. Vous recevrez une reponse personnelle, en general sous un jour ouvre. Si vous souhaitez ajouter quelque chose, repondez simplement a cet e-mail.",
  en: "Your message has reached us and a colleague is looking at it. You will get a personal reply, usually within one working day. If you want to add anything, just reply to this email.",
  pl: "Twoja wiadomosc do nas dotarla i zajmuje sie nia nasz pracownik. Otrzymasz osobista odpowiedz, zwykle w ciagu jednego dnia roboczego. Jesli chcesz cos dodac, po prostu odpowiedz na tego e-maila.",
  it: "Il suo messaggio e arrivato e un collega se ne sta occupando. Ricevera una risposta personale, di solito entro un giorno lavorativo. Se vuole aggiungere qualcosa, risponda pure a questa e-mail.",
  ro: "Mesajul dumneavoastra a ajuns la noi si un coleg se ocupa de el. Veti primi un raspuns personal, de obicei in aceeasi zi lucratoare sau in urmatoarea. Daca doriti sa adaugati ceva, raspundeti pur si simplu la acest e-mail.",
  cs: "Vase zprava k nam dorazila a venuje se ji kolega. Dostanete osobni odpoved, obvykle do jednoho pracovniho dne. Pokud chcete neco doplnit, staci odpovedet na tento e-mail.",
  hu: "Az uzenete megerkezett hozzank, es egy kollega foglalkozik vele. Szemelyes valaszt fog kapni, altalaban egy munkanapon belul. Ha szeretne meg valamit hozzafuzni, egyszeruen valaszoljon erre az e-mailre.",
  es: "Su mensaje nos ha llegado y un companero se esta ocupando de el. Recibira una respuesta personal, normalmente en un dia laborable. Si quiere anadir algo, responda sin mas a este correo.",
  tr: "Mesajiniz bize ulasti ve bir arkadasimiz ilgileniyor. Genellikle bir is gunu icinde kisisel bir yanit alacaksiniz. Eklemek istediginiz bir sey varsa bu e-postayi yanitlamaniz yeterli.",
};

/** Onderwerpregel voor de ontvangstbevestiging, als de mail er geen had. */
export const ONTVANGST_ONDERWERP: Record<BotTaal, string> = {
  nl: "Uw bericht",
  de: "Ihre Nachricht",
  fr: "Votre message",
  en: "Your message",
  pl: "Twoja wiadomosc",
  it: "Il suo messaggio",
  ro: "Mesajul dumneavoastra",
  cs: "Vase zprava",
  hu: "Az on uzenete",
  es: "Su mensaje",
  tr: "Mesajiniz",
};

/**
 * Zet de ondertekening onder een vaste tekst, in dezelfde vorm die het model
 * gebruikt: naam op een eigen regel, merk eronder.
 */
export function metOndertekening(tekst: string, naam: string, merk: string): string {
  return `${tekst}\n\n${naam}\n${merk}`;
}

/** Vertaalde tekst met terugval op Engels. */
export function kiesTekst(tabel: Record<BotTaal, string>, taal: string | undefined | null): string {
  const sleutel = (taal ?? "").toLowerCase() as BotTaal;
  return tabel[sleutel] ?? tabel.en;
}
