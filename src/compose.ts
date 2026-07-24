// Opstellaag (spec sectie 8, model claude-sonnet-5).
//
// Verantwoordelijkheid: uit een intent, de mail en de feitenset een concept
// maken. Het model kiest nooit een bedrag, een ontvanger of een actie; die
// komen uit de database (feiten), de betaling en de intent-enum.
//
// Escalatie-beslissing in deze laag:
//   - spam_overig      -> niet antwoorden, niet escaleren (archiveren).
//   - factuur, betaling_probleem, klacht_juridisch -> niet zelf opstellen,
//     altijd escaleren. Deze raken geld of recht; een mens schrijft het antwoord.
//   - mens_nodig       -> wel een concept opstellen als hulp voor Sabur, maar
//     altijd escaleren.
//   - kenteken_fout na inkoop -> escaleren (foutNaInkoop is een mensbeslissing).
//   - order onbekend bij een order-afhankelijke intent -> sinds 24-07 NIET
//     meer meteen escaleren: de bot vraagt zelf om het ordernummer of het
//     kenteken. Pas als dat al gebeurd is (of als de klant een VH-nummer noemde
//     dat niet bestaat) zet de lus magOrderVragen op false en escaleert deze
//     laag alsnog.
//   - overige (status_vraag, annuleren, bewijs_kwijt, product_vraag,
//     kenteken_fout voor inkoop) -> autonoom opstellen. product_vraag mag ook
//     ZONDER bestelling autonoom, puur uit de kennisbank.
// Zegt het model "dit weet ik niet" (sentinel) of komt er een leeg concept uit,
// dan wordt alsnog geescaleerd. De poller beslist wat er met de vlaggen gebeurt.

import {
  MODEL_OPSTELLEN,
  kiesModel,
  roepClaudeAan,
  geenKosten,
  type ClaudeKosten,
} from "./claude.js";
import {
  afzenderNaam,
  merkNaam,
  opstellenSysteem,
  opstellenGebruiker,
  NIET_WETEN_SENTINEL,
  type Opstelmodus,
} from "./prompts/opstellen.js";
import { metOndertekening } from "./teksten.js";
import { isIntent, type BotIntent, type BotTaal, isTaal } from "./prompts/classificatie.js";
import { bouwFeitenBlok, alsObject, leesTekst, type FeitenBlok } from "./feiten.js";
import {
  ORDER_GEBONDEN_INTENTS,
  naarLocale,
  type Concept,
  type InkomendeMail,
  type OpstelInvoer,
} from "./types.js";

/** Concreet conceptresultaat, los van het gedeelde Concept-type. */
export interface ConceptKern {
  /** De tekst van het antwoord. Leeg als er niets verstuurd mag worden. */
  tekst: string;
  taal: BotTaal;
  /** Voorstel-onderwerp voor het antwoord (Re: ...). */
  onderwerp: string;
  /** True = niet automatisch versturen, naar Sabur escaleren. */
  escaleren: boolean;
  /** Reden van escalatie, voor de melding aan Sabur. Leeg bij autonoom. */
  escalatieReden: string;
  /** True = niets doen, alleen archiveren (spam). */
  negeren: boolean;
  kosten: ClaudeKosten;
}

// Intents die geld of recht raken: nooit zelf beantwoorden.
const HARDE_ESCALATIE: ReadonlySet<BotIntent> = new Set<BotIntent>([
  "factuur",
  "betaling_probleem",
  "klacht_juridisch",
]);

// Intents die een gevonden order nodig hebben om zinnig te beantwoorden. Eén
// bron van waarheid: dezelfde lijst die de lus in index.ts gebruikt.
const ORDER_VEREIST: ReadonlySet<BotIntent> = new Set<BotIntent>(
  ORDER_GEBONDEN_INTENTS as readonly BotIntent[]
);

function bevatSentinel(tekst: string): boolean {
  return tekst.toLowerCase().includes(NIET_WETEN_SENTINEL);
}

/** Voorstel-onderwerp: Re: op het originele onderwerp, of een net alternatief. */
function bouwOnderwerp(origineel: string, feiten: FeitenBlok): string {
  const schoon = origineel.trim();
  if (schoon) {
    return /^re:/i.test(schoon) ? schoon : `Re: ${schoon}`;
  }
  return feiten.orderToken ? `Uw bestelling ${feiten.orderToken}` : "Uw bericht";
}

function leegConcept(
  taal: BotTaal,
  onderwerp: string,
  opts: { escaleren: boolean; escalatieReden?: string; negeren?: boolean },
): ConceptKern {
  return {
    tekst: "",
    taal,
    onderwerp,
    escaleren: opts.escaleren,
    escalatieReden: opts.escalatieReden ?? "",
    negeren: opts.negeren ?? false,
    kosten: geenKosten(MODEL_OPSTELLEN),
  };
}

export interface MailKern {
  van: string;
  onderwerp: string;
  tekst: string;
}

/**
 * Kernfunctie: stel een concept op. Werkt op een al gebouwd FeitenBlok en een
 * concrete mail, zodat de laag testbaar is met een gestubde Claude-client.
 */
export async function stelOpKern(
  intent: BotIntent,
  mail: MailKern,
  feiten: FeitenBlok,
  taalHint?: BotTaal,
  opties: { magOrderVragen?: boolean } = {},
): Promise<ConceptKern> {
  const taal: BotTaal = taalHint ?? (isTaal(feiten.taal) ? feiten.taal : "en");
  const onderwerp = bouwOnderwerp(mail.onderwerp, feiten);
  const magOrderVragen = opties.magOrderVragen ?? true;

  // Onbekende intent is nooit veilig autonoom.
  const veiligeIntent: BotIntent = isIntent(intent) ? intent : "mens_nodig";

  // 1. Spam: niets doen.
  if (veiligeIntent === "spam_overig") {
    return leegConcept(taal, onderwerp, { escaleren: false, negeren: true });
  }

  // 2. Geld- of rechtintents: nooit zelf beantwoorden.
  if (HARDE_ESCALATIE.has(veiligeIntent)) {
    return leegConcept(taal, onderwerp, {
      escaleren: true,
      escalatieReden: `intent ${veiligeIntent} raakt geld of recht, mens beslist`,
    });
  }

  // 3. Order-afhankelijke intent zonder gevonden order. Sinds 24-07 escaleert
  //    dit niet meer meteen: de bot vraagt eerst zelf om het ordernummer of het
  //    kenteken. De lus zet magOrderVragen op false zodra dat in deze thread al
  //    een keer gebeurd is, of als de klant een VH-nummer noemde dat niet
  //    bestaat; dan is doorvragen zinloos en kijkt een mens ernaar.
  const orderOntbreekt = ORDER_VEREIST.has(veiligeIntent) && !feiten.bekend;
  if (orderOntbreekt && !magOrderVragen) {
    return leegConcept(taal, onderwerp, {
      escaleren: true,
      escalatieReden: `intent ${veiligeIntent} heeft een order nodig, maar er is geen order gevonden`,
    });
  }

  // 4. Kentekenfout na inkoop: mensbeslissing (foutNaInkoop-procedure).
  if (veiligeIntent === "kenteken_fout" && feiten.bekend && !feiten.voorInkoop) {
    return leegConcept(taal, onderwerp, {
      escaleren: true,
      escalatieReden: "kenteken_fout terwijl er al is ingekocht, foutNaInkoop is een mensbeslissing",
    });
  }

  // 5. Opstellen met het model. mens_nodig krijgt ook een concept, maar escaleert altijd.
  //    De modus vertelt het model in welke situatie hij schrijft: met een
  //    bestelling, zonder bestelling maar met een algemene vraag, of met een
  //    ordervraag waarvan we de bestelling niet vinden.
  const modus: Opstelmodus = orderOntbreekt ? "order_onbekend" : feiten.bekend ? "normaal" : "algemeen";
  const systeem = opstellenSysteem(veiligeIntent, taal, feiten.land || null, modus);
  const gebruiker = opstellenGebruiker({
    intent: veiligeIntent,
    taal,
    feitenTekst: feiten.tekst,
    mailVan: mail.van,
    mailOnderwerp: mail.onderwerp,
    mailTekst: mail.tekst,
  });

  let tekst = "";
  let kosten = geenKosten(MODEL_OPSTELLEN);
  try {
    const antwoord = await roepClaudeAan({
      model: kiesModel("MAILBOT_MODEL_OPSTELLEN", MODEL_OPSTELLEN),
      systeem,
      gebruiker,
      // Ruim genoeg zodat adaptief denken plus het korte antwoord niet
      // afgekapt worden; ongebruikte ruimte kost niets. Medium inspanning is
      // voor een korte servicemail de goede balans tussen kwaliteit en kosten.
      maxTokens: 3000,
      inspanning: "medium",
      denken: "adaptive",
    });
    tekst = antwoord.tekst.trim();
    kosten = antwoord.kosten;
  } catch (e) {
    const bericht = e instanceof Error ? e.message : String(e);
    return {
      ...leegConcept(taal, onderwerp, {
        escaleren: true,
        escalatieReden: `opstellen mislukt: ${bericht}`,
      }),
    };
  }

  // Sentinel of leeg antwoord: escaleren, niets versturen.
  if (!tekst || bevatSentinel(tekst)) {
    return {
      tekst: "",
      taal,
      onderwerp,
      escaleren: true,
      escalatieReden: tekst ? "het model gaf aan het antwoord niet te weten" : "het model gaf een leeg antwoord",
      negeren: false,
      kosten,
    };
  }

  // mens_nodig blijft escaleren, maar met het opgestelde concept als hulp.
  const escaleren = veiligeIntent === "mens_nodig";
  return {
    tekst,
    taal,
    onderwerp,
    escaleren,
    escalatieReden: escaleren ? "intent mens_nodig, concept ter beoordeling meegestuurd" : "",
    negeren: false,
    kosten,
  };
}

// ---------------------------------------------------------------------------
// Contractfunctie uit types.ts.
//
// De lus in index.ts neemt de escalatiebeslissingen zelf (spam, geld/recht,
// geen order, identiteit) VOOR hij stelOp aanroept. stelOp levert daarom
// uitsluitend de tekst (het gedeelde Concept-type kent geen escalatievelden).
// Geeft de kern een leeg concept terug (sentinel of modelfout), dan keurt
// controleerConcept dat af als "leeg" en escaleert de lus alsnog.

function mailUitInkomend(mail: InkomendeMail): MailKern {
  const bron = alsObject(mail) ?? {};
  // InkomendeMail draagt de afzender in vanAdres en de voor het model
  // geschoonde tekst in tekstSchoon; die staan hier vooraan. De weergavenaam
  // gaat mee zodat de opsteller een nette aanhef met naam kan schrijven; hij
  // staat in het datablok en is dus gewoon data, geen instructie.
  const adres = leesTekst(bron, "vanAdres", "van", "from", "afzender");
  const naam = leesTekst(bron, "vanNaam");
  return {
    van: naam && adres ? `${naam} <${adres}>` : adres,
    onderwerp: leesTekst(bron, "onderwerp", "subject", "titel"),
    tekst: leesTekst(bron, "tekstSchoon", "tekstVolledig", "tekst", "body", "bericht", "inhoud", "text"),
  };
}

// Vaste, veilige tekst als de afzender niet de besteller is (spec sectie 4).
// Nooit ordergegevens, alleen het verzoek om vanaf het besteladres te schrijven.
// Bewust deterministisch per taal, niet via het model: geen injectie-oppervlak.
const IDENTITEIT_TEKST: Record<BotTaal, string> = {
  nl: "Voor uw privacy kunnen wij bestelgegevens alleen delen met het e-mailadres waarmee de bestelling is geplaatst. Wilt u ons mailen vanaf dat adres? Dan helpen wij u meteen verder.",
  de: "Zum Schutz Ihrer Daten koennen wir Bestellinformationen nur an die E-Mail-Adresse geben, mit der die Bestellung aufgegeben wurde. Bitte schreiben Sie uns von dieser Adresse, dann helfen wir Ihnen sofort weiter.",
  fr: "Pour votre confidentialite, nous ne pouvons communiquer les informations de commande qu'a l'adresse e-mail utilisee pour la commande. Ecrivez-nous depuis cette adresse et nous vous aiderons aussitot.",
  en: "For your privacy, we can only share order details with the email address used to place the order. Please write to us from that address and we will help you right away.",
  pl: "Ze wzgledu na prywatnosc mozemy udostepnic dane zamowienia wylacznie na adres e-mail uzyty do jego zlozenia. Prosimy o wiadomosc z tego adresu, a od razu pomozemy.",
  it: "Per la sua privacy possiamo condividere i dettagli dell'ordine solo con l'indirizzo e-mail usato per l'ordine. Ci scriva da quell'indirizzo e la aiuteremo subito.",
  ro: "Pentru confidentialitatea dumneavoastra putem transmite detaliile comenzii doar catre adresa de e-mail folosita la plasarea comenzii. Va rugam sa ne scrieti de la acea adresa si va vom ajuta imediat.",
  cs: "Z duvodu ochrany soukromi muzeme udaje o objednavce sdelit pouze na e-mailovou adresu, ze ktere byla objednavka podana. Napiste nam prosim z teto adresy a hned vam pomuzeme.",
  hu: "Az adatai vedelme erdekeben a rendelesi adatokat csak azzal az e-mail cimmel oszthatjuk meg, amellyel a rendelest leadtak. Kerjuk, irjon nekunk arrol a cimrol, es azonnal segitunk.",
  es: "Por su privacidad, solo podemos compartir los datos del pedido con el correo electronico usado para realizarlo. Escribanos desde esa direccion y le ayudaremos de inmediato.",
  tr: "Gizliliginiz icin siparis bilgilerini yalnizca siparisin verildigi e-posta adresiyle paylasabiliriz. Lutfen bize o adresten yazin, hemen yardimci olalim.",
};

function reOnderwerp(onderwerp: string): string {
  const schoon = (onderwerp ?? "").trim();
  if (!schoon) return "Uw bericht";
  return /^re:/i.test(schoon) ? schoon : `Re: ${schoon}`;
}

/**
 * Contractfunctie (types.ts, StelOpFn): stel een concept op uit de rijke
 * OpstelInvoer. Levert het gedeelde Concept-type (alleen tekst). De concrete
 * kern is los te testen via stelOpKern.
 */
export async function stelOp(invoer: OpstelInvoer): Promise<Concept> {
  const ruweTaal = invoer.classificatie?.taal;
  const taal: BotTaal = isTaal(ruweTaal) ? ruweTaal : "en";

  // Identiteit klopt niet: nooit ordergegevens, alleen de vaste privacy-tekst,
  // wel netjes aangekleed met aanhef en afsluitgroet in de taal van de klant.
  if (invoer.identiteitMismatch) {
    return {
      onderwerp: reOnderwerp(invoer.mail?.onderwerp ?? ""),
      tekst: metOndertekening(
        IDENTITEIT_TEKST[taal] ?? IDENTITEIT_TEKST.en,
        invoer.afzenderNaam || afzenderNaam(),
        merkNaam(),
        taal
      ),
      taal: naarLocale(taal),
    };
  }

  const feitenBlok = bouwFeitenBlok(invoer.order);
  const intent: BotIntent = isIntent(invoer.classificatie?.intent)
    ? invoer.classificatie.intent
    : "mens_nodig";
  const kern = await stelOpKern(intent, mailUitInkomend(invoer.mail), feitenBlok, taal, {
    magOrderVragen: invoer.magOrderVragen ?? true,
  });
  return {
    onderwerp: kern.onderwerp,
    tekst: kern.tekst,
    taal: naarLocale(kern.taal),
    kostenUsd: kern.kosten.kostenUsd,
  };
}
