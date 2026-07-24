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

/**
 * Vraag om het ordernummer bij een ANNULEERVERZOEK waarvan wij de bestelling
 * niet kunnen vinden. Bewust een vaste tekst en geen modelaanroep: bij
 * annuleren staat er geld op het spel, en het model zou uit de intent-instructie
 * kunnen opmaken dat het de annulering mag bevestigen. Deze tekst belooft niets,
 * bevestigt niets en noemt geen bedrag; hij vraagt alleen wat wij nodig hebben.
 * Sabur krijgt bij deze tekst ALTIJD ook een escalatie, want annuleren is
 * tijdkritisch: zodra er ingekocht is, kan kosteloos annuleren niet meer.
 */
export const ANNULEER_ORDERVRAAG_TEKST: Record<BotTaal, string> = {
  nl: "Wij hebben uw bericht. Om de juiste bestelling te vinden hebben wij uw ordernummer nodig, dat begint met VH en staat in uw bevestigingsmail. Het kenteken waarop u het vignet heeft aangevraagd helpt ook. Wilt u die gegevens sturen, dan pakken wij het meteen op. Heeft u haast, stuur dan ook even het e-mailadres waarmee u besteld heeft.",
  de: "Ihre Nachricht ist da. Um die richtige Bestellung zu finden, brauchen wir Ihre Bestellnummer, sie beginnt mit VH und steht in Ihrer Bestaetigungsmail. Auch das Kennzeichen hilft, fuer das die Vignette beantragt wurde. Schicken Sie uns diese Angaben, dann kuemmern wir uns sofort darum. Wenn es eilt, nennen Sie bitte auch die E-Mail-Adresse, mit der Sie bestellt haben.",
  fr: "Nous avons bien recu votre message. Pour retrouver la bonne commande, il nous faut votre numero de commande, il commence par VH et figure dans votre e-mail de confirmation. La plaque pour laquelle la vignette a ete demandee nous aide aussi. Envoyez-nous ces informations et nous nous en occupons tout de suite. Si c'est urgent, indiquez egalement l'adresse e-mail utilisee lors de la commande.",
  en: "We have your message. To find the right order we need your order number, it starts with VH and is in your confirmation email. The number plate the vignette was requested for helps too. Send us those details and we will pick it up right away. If it is urgent, please also mention the email address you ordered with.",
  pl: "Otrzymalismy Twoja wiadomosc. Aby odnalezc wlasciwe zamowienie, potrzebujemy numeru zamowienia, zaczyna sie od VH i znajduje sie w e-mailu potwierdzajacym. Pomocna jest rowniez tablica rejestracyjna, dla ktorej zamowiono winiete. Przeslij nam te dane, a od razu sie tym zajmiemy. Jesli sprawa jest pilna, podaj tez adres e-mail uzyty przy zamowieniu.",
  it: "Abbiamo ricevuto il suo messaggio. Per trovare l'ordine giusto ci serve il numero d'ordine, inizia con VH e si trova nella e-mail di conferma. Anche la targa per cui e stata richiesta la vignetta ci aiuta. Ci invii questi dati e ce ne occupiamo subito. Se ha fretta, indichi anche l'indirizzo e-mail con cui ha ordinato.",
  ro: "Am primit mesajul dumneavoastra. Pentru a gasi comanda potrivita avem nevoie de numarul comenzii, incepe cu VH si se afla in e-mailul de confirmare. Ne ajuta si numarul de inmatriculare pentru care a fost solicitata vinieta. Trimiteti-ne aceste date si ne ocupam imediat. Daca este urgent, mentionati va rugam si adresa de e-mail cu care ati comandat.",
  cs: "Vasi zpravu mame. Abychom nasli spravnou objednavku, potrebujeme cislo objednavky, zacina na VH a najdete ho v potvrzovacim e-mailu. Pomuze i registracni znacka, pro kterou byla dalnicni znamka objednana. Poslete nam tyto udaje a hned se do toho pustime. Pokud spechate, uvedte prosim i e-mailovou adresu, se kterou jste objednavali.",
  hu: "Megkaptuk az uzenetet. A megfelelo rendeles megtalalasahoz szuksegunk van a rendelesi szamra, amely VH-val kezdodik es a visszaigazolo e-mailben talalhato. A rendszam is segit, amelyre a matricat igenyeltek. Kuldje el ezeket az adatokat, es azonnal foglalkozunk vele. Ha surgos, kerjuk, adja meg azt az e-mail cimet is, amellyel rendelt.",
  es: "Hemos recibido su mensaje. Para encontrar el pedido correcto necesitamos su numero de pedido, empieza por VH y aparece en su correo de confirmacion. La matricula para la que se solicito la vineta tambien ayuda. Envienos esos datos y nos ocupamos de inmediato. Si tiene prisa, indique tambien el correo electronico con el que hizo el pedido.",
  tr: "Mesajinizi aldik. Dogru siparisi bulabilmek icin siparis numaranizi gerekiyor, VH ile baslar ve onay e-postanizda yer alir. Vinyetin talep edildigi plaka da yardimci olur. Bu bilgileri gonderirseniz hemen ilgilenelim. Aceleniz varsa siparis verirken kullandiginiz e-posta adresini de belirtin.",
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
 * Neutrale aanhef per taal. De vaste teksten kennen de naam van de klant niet,
 * dus dit is bewust een groet zonder naam.
 */
export const AANHEF: Record<BotTaal, string> = {
  nl: "Goedendag,",
  de: "Guten Tag,",
  fr: "Bonjour,",
  en: "Hello,",
  pl: "Dzien dobry,",
  it: "Buongiorno,",
  ro: "Buna ziua,",
  cs: "Dobry den,",
  hu: "Jo napot kivanok,",
  es: "Buenos dias,",
  tr: "Merhaba,",
};

/** Afsluitgroet per taal, boven de naam en het merk. */
export const AFSLUITGROET: Record<BotTaal, string> = {
  nl: "Met vriendelijke groet,",
  de: "Mit freundlichen Gruessen,",
  fr: "Cordialement,",
  en: "Kind regards,",
  pl: "Z wyrazami szacunku,",
  it: "Cordiali saluti,",
  ro: "Cu stima,",
  cs: "S pozdravem,",
  hu: "Udvozlettel,",
  es: "Un cordial saludo,",
  tr: "Saygilarimizla,",
};

/**
 * Maakt van een vaste kerntekst een complete nette mail: aanhef erboven,
 * afsluitgroet met naam en merk eronder, alles in de taal van de klant.
 */
export function metOndertekening(tekst: string, naam: string, merk: string, taal?: string | null): string {
  const aanhef = kiesTekst(AANHEF, taal ?? "en");
  const groet = kiesTekst(AFSLUITGROET, taal ?? "en");
  return `${aanhef}\n\n${tekst}\n\n${groet}\n${naam}\n${merk}`;
}

/** Vertaalde tekst met terugval op Engels. */
export function kiesTekst(tabel: Record<BotTaal, string>, taal: string | undefined | null): string {
  const sleutel = (taal ?? "").toLowerCase() as BotTaal;
  return tabel[sleutel] ?? tabel.en;
}
