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

/**
 * Afschrijvingsklacht (betaling_probleem) terwijl er op het afzenderadres GEEN
 * bestelling bestaat en de klant ook geen VH-nummer noemde. In de praktijk is
 * dit vrijwel altijd een afschrijving van een ANDER bedrijf (abonnementsdienst,
 * andere vignetaanbieder) die de klant met ons verwart; wij hebben geen
 * abonnementen en schrijven per bestelling precies een keer af.
 *
 * Bewust een vaste tekst en geen modelaanroep: dit raakt geld. De tekst noemt
 * geen bedrag, belooft niets en bevestigt niets; hij legt uit hoe de klant het
 * echte bedrijf vindt en houdt de deur open voor het geval er toch een
 * bestelling onder een ander e-mailadres bestaat. Besluit Sabur 03-08.
 */
export const GEEN_AFSCHRIJVING_TEKST: Record<BotTaal, string> = {
  nl: "Wij hebben dit direct nagekeken: op uw e-mailadres staat bij VignetteHub geen bestelling en er loopt bij ons ook geen afschrijving. VignetteHub verkoopt losse digitale vignetten en heeft geen abonnementen; wij schrijven per bestelling precies een keer af en nooit automatisch opnieuw. De afschrijving die u ziet komt dus van een ander bedrijf. Op uw bank- of kaartafschrift staat de naam van dat bedrijf bij de afschrijving; neem daarmee contact op of laat uw bank de afschrijving terugdraaien. Heeft u wel bij ons besteld, misschien met een ander e-mailadres? Stuur ons dan uw ordernummer (het begint met VH) of uw kenteken, dan zoeken wij het meteen voor u uit.",
  de: "Wir haben das sofort geprueft: Unter Ihrer E-Mail-Adresse gibt es bei VignetteHub keine Bestellung und auch keine laufende Abbuchung. VignetteHub verkauft einzelne digitale Vignetten und hat keine Abos; wir buchen pro Bestellung genau einmal ab und nie automatisch erneut. Die Abbuchung, die Sie sehen, stammt also von einem anderen Unternehmen. Auf Ihrem Konto- oder Kartenauszug steht der Name dieses Unternehmens neben der Abbuchung; wenden Sie sich direkt dorthin oder lassen Sie die Abbuchung von Ihrer Bank zurueckbuchen. Haben Sie doch bei uns bestellt, vielleicht mit einer anderen E-Mail-Adresse? Schicken Sie uns dann Ihre Bestellnummer (sie beginnt mit VH) oder Ihr Kennzeichen, dann pruefen wir das sofort fuer Sie.",
  fr: "Nous avons verifie tout de suite: aucune commande et aucun prelevement en cours chez VignetteHub pour votre adresse e-mail. VignetteHub vend des vignettes numeriques a l'unite et ne propose aucun abonnement; nous debitons exactement une fois par commande, jamais automatiquement. Le prelevement que vous voyez provient donc d'une autre entreprise. Le nom de cette entreprise figure a cote du prelevement sur votre releve bancaire; contactez-la directement ou demandez a votre banque d'annuler le prelevement. Vous avez bien commande chez nous, peut-etre avec une autre adresse e-mail? Envoyez-nous alors votre numero de commande (il commence par VH) ou votre plaque, et nous verifions cela tout de suite.",
  en: "We checked this right away: there is no order and no charge from VignetteHub linked to your email address. VignetteHub sells single digital vignettes and has no subscriptions; we charge exactly once per order and never automatically again. The charge you see therefore comes from a different company. The name of that company is shown next to the charge on your bank or card statement; contact them directly or ask your bank to reverse the charge. Did you order from us after all, perhaps with a different email address? Then send us your order number (it starts with VH) or your number plate and we will look into it right away.",
  pl: "Sprawdzilismy to od razu: na Twoj adres e-mail nie ma w VignetteHub zadnego zamowienia ani zadnej pobranej platnosci. VignetteHub sprzedaje pojedyncze winiety cyfrowe i nie prowadzi abonamentow; pobieramy oplate dokladnie raz za zamowienie i nigdy automatycznie ponownie. Obciazenie, ktore widzisz, pochodzi wiec od innej firmy. Nazwa tej firmy widnieje przy obciazeniu na wyciagu z banku lub karty; skontaktuj sie z nia bezposrednio albo popros bank o cofniecie obciazenia. A moze jednak zamawiales u nas, tylko z innego adresu e-mail? Przeslij nam wtedy numer zamowienia (zaczyna sie od VH) lub numer rejestracyjny, a od razu to sprawdzimy.",
  it: "Abbiamo controllato subito: al suo indirizzo e-mail non risulta alcun ordine ne alcun addebito presso VignetteHub. VignetteHub vende singole vignette digitali e non ha abbonamenti; addebitiamo esattamente una volta per ordine e mai in automatico. L'addebito che vede proviene quindi da un'altra azienda. Il nome di quell'azienda compare accanto all'addebito sull'estratto conto della banca o della carta; la contatti direttamente oppure chieda alla sua banca di stornare l'addebito. Ha invece ordinato da noi, magari con un altro indirizzo e-mail? Ci invii allora il numero d'ordine (inizia con VH) o la targa, e lo verifichiamo subito.",
  ro: "Am verificat imediat: pe adresa dumneavoastra de e-mail nu exista la VignetteHub nicio comanda si nicio incasare. VignetteHub vinde viniete digitale individuale si nu are abonamente; incasam exact o singura data per comanda si niciodata automat din nou. Suma retrasa pe care o vedeti provine deci de la o alta firma. Numele acelei firme apare langa tranzactie pe extrasul de cont; contactati-o direct sau cereti bancii sa anuleze plata. Ati comandat totusi la noi, poate cu alta adresa de e-mail? Trimiteti-ne atunci numarul comenzii (incepe cu VH) sau numarul de inmatriculare si verificam imediat.",
  cs: "Hned jsme to proverili: na vasi e-mailovou adresu neni u VignetteHub zadna objednavka ani zadna platba. VignetteHub prodava jednotlive digitalni znamky a nema zadne predplatne; strhavame presne jednou za objednavku a nikdy automaticky znovu. Platba, kterou vidite, tedy pochazi od jine firmy. Nazev te firmy najdete vedle platby na vypisu z uctu nebo karty; obratte se primo na ni, nebo pozadejte svou banku o vraceni platby. Objednali jste presto u nas, treba z jine e-mailove adresy? Poslete nam cislo objednavky (zacina na VH) nebo registracni znacku a hned to proverime.",
  hu: "Azonnal utananeztunk: az e-mail cimehez a VignetteHubnal nem tartozik sem rendeles, sem levonas. A VignetteHub egyszeri digitalis matricakat ertekesit, elofizetesunk nincs; rendelesenkent pontosan egyszer terhelunk, es soha nem automatikusan ujra. A levonas, amit lat, tehat egy masik cegtol szarmazik. Annak a cegnek a neve a bank- vagy kartyakivonaton a tetel mellett szerepel; forduljon kozvetlenul hozzajuk, vagy kerje bankjat a levonas visszavonasara. Megis nalunk rendelt, esetleg masik e-mail cimmel? Kuldje el a rendelesi szamat (VH-val kezdodik) vagy a rendszamat, es azonnal utananezunk.",
  es: "Lo hemos comprobado de inmediato: en su direccion de correo no hay en VignetteHub ningun pedido ni ningun cargo. VignetteHub vende vinetas digitales sueltas y no tiene suscripciones; cobramos exactamente una vez por pedido y nunca de forma automatica. El cargo que ve procede por tanto de otra empresa. El nombre de esa empresa aparece junto al cargo en el extracto de su banco o tarjeta; contacte directamente con ella o pida a su banco que devuelva el cargo. Si de verdad pidio con nosotros, quiza con otro correo electronico, envienos su numero de pedido (empieza por VH) o su matricula y lo revisamos de inmediato.",
  tr: "Bunu hemen kontrol ettik: e-posta adresinize kayitli VignetteHub siparisi veya tahsilat bulunmuyor. VignetteHub tek seferlik dijital vinyetler satar ve abonelik sistemimiz yoktur; siparis basina tam bir kez tahsil ederiz ve asla otomatik olarak tekrar cekmeyiz. Gordugunuz tahsilat bu yuzden baska bir sirkete ait. O sirketin adi banka veya kart ekstrenizde islemin yaninda yazar; dogrudan onlarla iletisime gecin veya bankanizdan islemi geri aldirmasini isteyin. Yine de bizden siparis verdiyseniz, belki baska bir e-posta adresiyle, siparis numaranizi (VH ile baslar) veya plakanizi gonderin, hemen inceleyelim.",
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
