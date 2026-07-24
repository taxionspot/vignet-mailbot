// De hoofdlus van de VignetteHub mailbot (spec sectie 5, 6, 8, 9).
//
// Per mail: door de lus-beveiliging, classificeren, matchen, beslissen,
// opstellen, controleren, versturen of escaleren, en loggen. De LLM-laag en de
// acties komen van andere bouwers; ze worden geimporteerd uit ./classify,
// ./compose, ./verify en ./acties volgens de handtekeningen in src/types.ts.
//
// De lus is bewust SEQUENTIEEL: een mail tegelijk. Dat houdt de caps-state
// (een enkel bestand) correct zonder vergrendeling en houdt de belasting op de
// LLM en de app laag.

import { config } from "./config.js";
import { log } from "./log.js";
import { parseMail } from "./parse.js";
import { Postbus } from "./imap.js";
import { geenMatch, matchOrder, type MatchResultaat } from "./match.js";
import { ApiFout } from "./api.js";
import { schrijfLog } from "./api.js";
import {
  lusBeveiliging,
  magVerwerken,
  magVersturen,
  magRefunden,
  magAntwoorden,
  registreerAntwoord,
  magRefunderen,
  registreerRefund,
  orderVraagGesteld,
  registreerOrderVraag,
  type CapUitkomst,
} from "./guards.js";
import {
  ESCALATIE_INTENTS,
  NA_INKOOP_STATUSSEN,
  ORDER_GEBONDEN_INTENTS,
  REFUNDBARE_STATUSSEN,
  naarLocale,
  type AntwoordOpdracht,
  type Classificatie,
  type Concept,
  type EscalatieOpdracht,
  type EscalatieReden,
  type GelogdeActie,
  type InkomendeMail,
  type Intent,
  type MailBotLogRegel,
  type OpstelInvoer,
  type OrderFeiten,
} from "./types.js";
import { drempelVoor, isTaal, type BotIntent, type BotTaal, type Drempels } from "./prompts/classificatie.js";
import { merkNaam } from "./prompts/opstellen.js";
import {
  ANNULEER_ORDERVRAAG_TEKST,
  ONTVANGST_ONDERWERP,
  ONTVANGST_TEKST,
  kiesTekst,
  metOndertekening,
} from "./teksten.js";

// De vier functies van de andere bouwers. Relatieve imports eindigen op .js
// (ESM met NodeNext), ook al heten de bronbestanden .ts.
import { classificeer } from "./classify.js";
import { stelOp } from "./compose.js";
import { controleerConcept } from "./verify.js";
import { voerActieUit } from "./acties.js";

// ---------------------------------------------------------------------------
// Uitstel-fout: de app is even onbereikbaar, mail later opnieuw proberen
// ---------------------------------------------------------------------------

// Gooien we deze, dan laat de lus de mail ONGEMOEID in INBOX staan (niet
// gemarkeerd, niet verplaatst), zodat de volgende ronde het opnieuw probeert.
// Dat is anders dan een echte crash, die naar Bot/Fout gaat.
class UitstelFout extends Error {
  constructor(bericht: string) {
    super(bericht);
    this.name = "UitstelFout";
  }
}

// ---------------------------------------------------------------------------
// Uitkomst van het verwerken van een mail
// ---------------------------------------------------------------------------

interface VerwerkUitkomst {
  /** IMAP-map waar de mail heen moet. */
  bestemming: string;
  /** De logregel is al weggeschreven binnen verwerkMail; dit is puur voor debug. */
  actie: GelogdeActie;
}

// ---------------------------------------------------------------------------
// Hulp: opdrachten bouwen
// ---------------------------------------------------------------------------

// Threading-headers voor een antwoord: In-Reply-To de mail waarop we
// reageren, References de bestaande keten plus die mail.
function threadHeaders(mail: InkomendeMail): { inReplyTo?: string; references?: string[] } {
  const references = [...mail.references];
  if (mail.messageId && !references.includes(mail.messageId)) {
    references.push(mail.messageId);
  }
  return {
    inReplyTo: mail.messageId ?? undefined,
    references: references.length > 0 ? references : undefined,
  };
}

function bouwAntwoordOpdracht(mail: InkomendeMail, concept: Concept, orderToken?: string): AntwoordOpdracht {
  const { inReplyTo, references } = threadHeaders(mail);
  return {
    actie: "antwoord_sturen",
    botMailId: mail.botMailId,
    orderToken,
    naar: mail.vanAdres,
    onderwerp: concept.onderwerp,
    tekst: concept.tekst,
    html: concept.html,
    taal: concept.taal,
    inReplyTo,
    references,
  };
}

function bouwEscalatie(
  mail: InkomendeMail,
  opts: {
    reden: EscalatieReden;
    toelichting: string;
    spoed?: boolean;
    concept?: Concept;
    intent?: Intent;
    vertrouwen?: number;
    orderToken?: string;
  }
): EscalatieOpdracht {
  return {
    actie: "escalatie_sturen",
    botMailId: mail.botMailId,
    orderToken: opts.orderToken,
    reden: opts.reden,
    toelichting: opts.toelichting,
    spoed: opts.spoed ?? false,
    origineel: {
      van: mail.vanAdres,
      onderwerp: mail.onderwerp,
      ontvangenAt: mail.ontvangenAt.toISOString(),
      tekst: mail.tekstVolledig,
    },
    concept: opts.concept
      ? { onderwerp: opts.concept.onderwerp, tekst: opts.concept.tekst, taal: opts.concept.taal }
      : undefined,
    intent: opts.intent,
    vertrouwen: opts.vertrouwen,
  };
}

// De twee vertrouwensdrempels uit config, in het formaat dat classify en
// drempelVoor verwachten. Geld en recht streng, informatie soepel.
const DREMPELS: Drempels = {
  streng: config.vertrouwenDrempel,
  info: config.vertrouwenDrempelInfo,
};

// ---------------------------------------------------------------------------
// Escaleren met een ontvangstbevestiging voor de klant
// ---------------------------------------------------------------------------

// Redenen waarbij de klant BEWUST niets hoort:
//   - klacht_juridisch: bij een advocaat, chargeback of dreiging schrijft een
//     mens de eerste zin, ook de bevestigende (besluit Sabur 24-07).
//   - verzending_uit en cap_bereikt: dat zijn juist de noodremmen op uitgaande
//     post. Er dan alsnog een mail doorheen duwen ondermijnt de rem.
//   - identiteit_mismatch: die klant krijgt al een echt antwoord.
const GEEN_BEVESTIGING: ReadonlySet<EscalatieReden> = new Set<EscalatieReden>([
  "intent_klacht_juridisch",
  "verzending_uit",
  "cap_bereikt",
  "identiteit_mismatch",
  // Bij een refund met onbekende uitkomst kan de app zijn annuleringsmail al
  // verstuurd hebben. Een bevestiging erbovenop zou de klant eerst
  // "geannuleerd en terugbetaald" laten lezen en daarna "uw bericht ligt bij
  // een collega". Dat is tegenstrijdig, dus hier zwijgen we.
  "actie_onbekend",
]);

/**
 * Mag de bot deze afzender uberhaupt mailen?
 *
 * Het From-adres is zonder authenticatie te vervalsen. Voor 24-07 was dat
 * ongevaarlijk: een afzender zonder gekoppelde bestelling kreeg nooit iets
 * terug. Nu de bot ook onbekende afzenders antwoordt, zou iemand met een
 * vervalst From-adres onze bot post kunnen laten sturen naar een willekeurige
 * derde. Daarom: is er geen bestelling aan deze afzender te koppelen, dan moet
 * DMARC of DKIM bewijzen dat het adres echt is.
 *
 * Is er WEL een bestelling met kloppende identiteit, dan verandert er niets
 * ten opzichte van het oude gedrag: die klant krijgt gewoon antwoord.
 */
function magKlantMailen(mail: InkomendeMail, gekoppeldeOrder: boolean): boolean {
  if (gekoppeldeOrder) return true;
  if (!config.schakelaars.eisAuthenticatie) return true;
  return mail.afzenderGeauthenticeerd;
}

/** De taal van de klant, met terugval op Engels. */
function taalVan(classificatie: Classificatie | null): BotTaal {
  const ruw = classificatie?.taal;
  return isTaal(ruw) ? ruw : "en";
}

/** Onderwerp voor een vaste-tekst-antwoord: Re: op het origineel, of een net alternatief. */
function reOnderwerpVan(mail: InkomendeMail, taal: BotTaal): string {
  const schoon = (mail.onderwerp ?? "").trim();
  if (!schoon) return kiesTekst(ONTVANGST_ONDERWERP, taal);
  return /^re:/i.test(schoon) ? schoon : `Re: ${schoon}`;
}

/**
 * Stuurt de escalatie naar Sabur en, als dat mag, een korte ontvangstbevestiging
 * naar de klant. Zonder die bevestiging blijft het voor de klant stil tot Sabur
 * zelf antwoordt, en dat was voor 24-07 de stille kant van elke escalatie.
 *
 * De bevestiging is een vaste tekst per taal: geen modelaanroep, dus geen
 * kosten, geen injectie-oppervlak en geen tweede ding dat kan mislukken. Faalt
 * het versturen toch, dan wordt dat alleen gelogd: een escalatie mag nooit
 * afhangen van een bevestigingsmail.
 *
 * Geeft terug of de klant iets gehoord heeft, voor de logregel.
 */
async function escaleerNaarSabur(
  mail: InkomendeMail,
  esc: EscalatieOpdracht,
  classificatie: Classificatie | null,
  regel?: MailBotLogRegel,
  opts: { gekoppeldeOrder?: boolean } = {}
): Promise<boolean> {
  await voerActieUit(esc);

  if (!config.schakelaars.ontvangstbevestiging) return false;
  if (GEEN_BEVESTIGING.has(esc.reden)) return false;
  // Geen classificatie betekent dat we de taal niet kennen; dan liever niets
  // sturen dan een klant in de verkeerde taal aanschrijven.
  if (!classificatie) return false;
  if (!magVersturen()) return false;
  if (!magKlantMailen(mail, opts.gekoppeldeOrder ?? Boolean(esc.orderToken))) {
    log.info(`Geen bevestiging aan ${mail.vanAdres}: afzender niet geauthenticeerd en geen gekoppelde bestelling`);
    return false;
  }

  // Stil toetsen: raakt de cap dicht te zitten, dan sturen we niets, maar we
  // mogen de eenmalige cap-melding aan Sabur niet opbranden met een
  // bevestigingsmail. Die melding hoort bij het echte antwoordpad.
  const cap = magAntwoorden(mail, { stil: true });
  if (cap.geblokkeerd) return false;

  const taal = taalVan(classificatie);
  const tekst = metOndertekening(
    kiesTekst(ONTVANGST_TEKST, taal),
    config.afzenderNaam,
    merkNaam()
  );
  const onderwerp = reOnderwerpVan(mail, taal);

  const opdracht = bouwAntwoordOpdracht(
    mail,
    { onderwerp, tekst, taal: naarLocale(taal) },
    esc.orderToken
  );

  try {
    const res = await voerActieUit(opdracht);
    if (res.ok && res.uitgevoerd) {
      registreerAntwoord(mail);
      if (regel) {
        regel.melding = regel.melding
          ? `${regel.melding}; ontvangstbevestiging verstuurd`
          : "ontvangstbevestiging verstuurd";
      }
      log.info(`Ontvangstbevestiging (${taal}) verstuurd aan ${mail.vanAdres}`);
      return true;
    }
    log.warn(`Ontvangstbevestiging niet verstuurd aan ${mail.vanAdres}: ${res.fout ?? "onbekend"}`);
  } catch (err) {
    log.warn(`Ontvangstbevestiging mislukt aan ${mail.vanAdres}`, err);
  }
  return false;
}

// Basis-logregel met de gemeenschappelijke velden ingevuld.
function basisLog(
  mail: InkomendeMail,
  classificatie: Classificatie | null,
  order: OrderFeiten | null
): MailBotLogRegel {
  return {
    botMailId: mail.botMailId,
    ontvangenAt: mail.ontvangenAt.toISOString(),
    van: mail.vanAdres,
    onderwerp: mail.onderwerp,
    orderToken: order?.orderToken,
    intent: classificatie?.intent,
    vertrouwen: classificatie?.vertrouwen,
    taal: classificatie?.taal,
    actie: "geen",
    escalatie: false,
    kostenUsd: classificatie?.kostenUsd,
  };
}

// ---------------------------------------------------------------------------
// Opstellen plus controleren van een klant-antwoord
// ---------------------------------------------------------------------------

// Stelt een concept op en draait de drie controles (spec sectie 8). Geeft het
// concept terug als het door de controle komt, anders null plus de reden.
async function conceptVoorKlant(
  invoer: OpstelInvoer
): Promise<{ concept: Concept } | { afgekeurd: string }> {
  const concept = await stelOp(invoer);
  const controle = await controleerConcept(concept, invoer);
  if (!controle.ok) {
    const reden = controle.problemen.map((p) => `${p.code}: ${p.detail}`).join("; ");
    return { afgekeurd: reden || "onbekende reden" };
  }
  return { concept };
}

// ---------------------------------------------------------------------------
// De kern: een mail verwerken
// ---------------------------------------------------------------------------

// Verstuurt een klant-antwoord met alle poorten ervoor: schakelaar SEND en de
// drie antwoord-caps. Geeft terug wat er gebeurd is, zodat de aanroeper de
// juiste logregel en bestemming kan kiezen.
async function verstuurKlantAntwoord(
  mail: InkomendeMail,
  concept: Concept,
  order: OrderFeiten | null
): Promise<
  | { soort: "verstuurd" }
  | { soort: "cap"; uitkomst: CapUitkomst }
  | { soort: "send_uit" }
  | { soort: "mislukt"; fout?: string }
> {
  // Schakelaar SEND. Staat hij uit, dan versturen we niets naar de klant.
  if (!magVersturen()) {
    return { soort: "send_uit" };
  }
  // Antwoord-caps (thread, afzender, dag).
  const cap = magAntwoorden(mail);
  if (cap.geblokkeerd) {
    return { soort: "cap", uitkomst: cap };
  }
  const opdracht = bouwAntwoordOpdracht(mail, concept, order?.orderToken);
  const res = await voerActieUit(opdracht);
  if (res.ok && res.uitgevoerd) {
    registreerAntwoord(mail);
    return { soort: "verstuurd" };
  }
  return { soort: "mislukt", fout: res.fout };
}

// De grote beslisboom. Retourneert de bestemming; schrijft zelf de logregel.
async function verwerkMail(mail: InkomendeMail): Promise<VerwerkUitkomst> {
  // ---- 1. Lus-beveiliging (spec sectie 9) ----
  const lus = lusBeveiliging(mail);
  if (lus.blokkeer) {
    const regel = basisLog(mail, null, null);
    regel.actie = "geen";
    regel.bestemming = config.mappen.afgehandeld;
    regel.fout = lus.reden ?? undefined;
    await schrijfLog(regel);
    log.info(`Geblokkeerd (${lus.reden}), gearchiveerd: ${mail.vanAdres}`);
    return { bestemming: config.mappen.afgehandeld, actie: "geen" };
  }

  // ---- 2. Classificeren (LLM 1) ----
  let classificatie: Classificatie;
  try {
    classificatie = await classificeer(mail, DREMPELS);
  } catch (err) {
    // Classificatie mislukt: als mens_nodig behandelen en escaleren zonder concept.
    log.warn(`Classificatie mislukt voor ${mail.botMailId}, escaleren`, err);
    const esc = bouwEscalatie(mail, {
      reden: "intent_mens_nodig",
      toelichting: `Classificatie mislukte (${err instanceof Error ? err.message : "onbekend"}). Handmatig beoordelen.`,
    });
    await voerActieUit(esc);
    const regel = basisLog(mail, null, null);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "intent_mens_nodig";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = "classificatie_mislukt";
    await schrijfLog(regel);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  // Vertrouwen onder de drempel gaat naar mens_nodig. De drempel hangt af van
  // wat er op het spel staat: 0,75 voor geld en recht, 0,45 voor informatie
  // (drempelVoor). classify.ts past hetzelfde vangnet al toe; deze tweede
  // controle vangt een classificatie af die van elders komt.
  let intent: Intent = classificatie.intent;
  const drempel = drempelVoor(intent as BotIntent, DREMPELS);
  if (intent !== "spam_overig" && classificatie.vertrouwen < drempel) {
    log.info(`Vertrouwen ${classificatie.vertrouwen.toFixed(2)} < ${drempel} voor ${intent}, dus mens_nodig`);
    intent = "mens_nodig";
  }

  // ---- spam_overig: archiveren, niet antwoorden ----
  if (intent === "spam_overig") {
    const regel = basisLog(mail, classificatie, null);
    regel.actie = "geen";
    regel.bestemming = config.mappen.afgehandeld;
    await schrijfLog(regel);
    log.info(`Spam/overig, gearchiveerd: ${mail.vanAdres}`);
    return { bestemming: config.mappen.afgehandeld, actie: "geen" };
  }

  const isEscalatieIntent = (ESCALATIE_INTENTS as readonly Intent[]).includes(intent);

  // ---- 3. Order matchen (spec sectie 4) ----
  let match: MatchResultaat;
  try {
    match = await matchOrder(mail);
  } catch (err) {
    if (err instanceof ApiFout && err.soort === "onbekend") {
      if (isEscalatieIntent) {
        // Een juridische klacht of factuurvraag mag nooit blijven hangen omdat
        // de order-API even plat ligt: escaleer zonder ordercontext.
        log.warn(`Order-lookup faalde, escaleer toch (${intent})`, err);
        match = geenMatch(null);
      } else {
        // Autonome intent zonder order kunnen we niet veilig afhandelen: uitstellen.
        throw new UitstelFout(`order-API onbereikbaar bij ${mail.botMailId}: ${err.message}`);
      }
    } else {
      throw err; // echte fout -> Bot/Fout
    }
  }

  const order = match.order;

  // ---- 4a. Escalatie-only intents (factuur, betaling, klacht, mens_nodig) ----
  if (isEscalatieIntent) {
    return await escaleerIntent(mail, classificatie, intent, order, match);
  }

  // ---- 4b. Identiteitsregel (spec sectie 4, hard) ----
  // Order gevonden maar afzender is niet de besteller: geen gegevens prijsgeven,
  // korte reply "schrijf vanaf uw besteladres", plus escaleren naar Sabur. De
  // check op order !== null narrowt order meteen naar OrderFeiten.
  if (order !== null && match.identiteitMismatch) {
    return await verwerkIdentiteitMismatch(mail, classificatie, order);
  }

  // ---- 4c. Geen order gevonden ----
  // Tot 24-07 ging ELKE mail zonder gevonden bestelling meteen naar Sabur, ook
  // een algemene vraag die prima uit de kennisbank te beantwoorden was. Dat was
  // de grootste bron van onnodige escalaties. Nu splitsen we:
  //   - niet-ordergebonden vraag (product_vraag) -> gewoon zelf beantwoorden;
  //   - ordergebonden vraag -> eerst zelf om ordernummer of kenteken vragen.
  // Vanaf hier narrowt de vergelijking order naar OrderFeiten voor de rest.
  if (order === null) {
    if (!(ORDER_GEBONDEN_INTENTS as readonly Intent[]).includes(intent)) {
      return await verwerkAlgemeneVraag(mail, classificatie, intent);
    }
    return await verwerkOrderOnbekend(mail, classificatie, intent, match);
  }

  // ---- 5. Autonome afhandeling met geldige order en kloppende identiteit ----
  switch (intent) {
    case "status_vraag":
    case "product_vraag":
    // bewijs_kwijt was tot 24-07 een resend-actie (bevestiging of bewijs-PDF
    // opnieuw sturen via de app). Sinds wij namens de klant op zijn eigen
    // e-mailadres inkopen bestaat er geen bewijsdocument van ons meer: het
    // officiele portaal mailt de klant rechtstreeks. De bot legt dat nu uit in
    // een gewoon opgesteld antwoord, met de controlelink uit de kennisbank.
    case "bewijs_kwijt":
      return await verwerkKlantAntwoordIntent(mail, classificatie, order, match);
    case "kenteken_fout":
      return await verwerkKentekenFout(mail, classificatie, order, match);
    case "annuleren":
      return await verwerkAnnuleren(mail, classificatie, order, match);
    default: {
      // Zou niet mogen voorkomen (alle intents zijn hierboven behandeld), maar
      // vangen we defensief af als mens_nodig.
      const esc = bouwEscalatie(mail, {
        reden: "intent_mens_nodig",
        toelichting: `Onverwachte intent ${intent}. Handmatig beoordelen.`,
        intent: classificatie.intent,
        vertrouwen: classificatie.vertrouwen,
        orderToken: order.orderToken,
      });
      await voerActieUit(esc);
      const regel = basisLog(mail, classificatie, order);
      regel.actie = "escalatie_sturen";
      regel.escalatie = true;
      regel.escalatieReden = "intent_mens_nodig";
      regel.bestemming = config.mappen.escalatie;
      await schrijfLog(regel);
      return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
    }
  }
}

// ---------------------------------------------------------------------------
// Deelroutes
// ---------------------------------------------------------------------------

// Escalatie-only intents. Klant krijgt niets (spec sectie 5), behalve dat we
// voor mens_nodig een concept meesturen voor Sabur.
async function escaleerIntent(
  mail: InkomendeMail,
  classificatie: Classificatie,
  intent: Intent,
  order: OrderFeiten | null,
  match: MatchResultaat
): Promise<VerwerkUitkomst> {
  const redenMap: Record<string, EscalatieReden> = {
    factuur: "intent_factuur",
    betaling_probleem: "intent_betaling",
    klacht_juridisch: "intent_klacht_juridisch",
    mens_nodig: classificatie.vertrouwen < config.vertrouwenDrempel ? "laag_vertrouwen" : "intent_mens_nodig",
  };
  const reden: EscalatieReden = redenMap[intent] ?? "intent_mens_nodig";
  const spoed = intent === "klacht_juridisch";

  // Alleen voor mens_nodig een concept meesturen (tabel sectie 5). Voor de
  // andere drie is een concept overbodig en zou het onnodig LLM-kosten maken.
  let concept: Concept | undefined;
  if (intent === "mens_nodig" && order && !match.identiteitMismatch) {
    try {
      const uit = await conceptVoorKlant({
        mail,
        classificatie,
        order,
        identiteitMismatch: false,
        meerdereOrders: match.aantalGevonden > 1,
        voorgesteldeActie: "antwoord_sturen",
        refundToegestaan: false,
        naInkoop: (NA_INKOOP_STATUSSEN as readonly string[]).includes(order.fulfilmentStatus),
        doel: "escalatie",
        afzenderNaam: config.afzenderNaam,
      });
      if ("concept" in uit) concept = uit.concept;
    } catch (err) {
      log.warn(`Concept voor escalatie mislukt (niet fataal)`, err);
    }
  }

  const esc = bouwEscalatie(mail, {
    reden,
    toelichting: `Intent ${intent}. ${order ? `Order ${order.orderToken}.` : "Geen order gevonden."}${
      match.identiteitMismatch ? " LET OP: afzender is niet de besteller." : ""
    }`,
    spoed,
    concept,
    intent: classificatie.intent,
    vertrouwen: classificatie.vertrouwen,
    orderToken: order?.orderToken,
  });

  const regel = basisLog(mail, classificatie, order);
  await escaleerNaarSabur(mail, esc, classificatie, regel);
  regel.actie = "escalatie_sturen";
  regel.escalatie = true;
  regel.escalatieReden = reden;
  regel.bestemming = config.mappen.escalatie;
  if (concept) regel.antwoordTekst = concept.tekst;
  await schrijfLog(regel);
  log.info(`Escalatie (${reden})${spoed ? " SPOED" : ""}: ${mail.vanAdres}`);
  return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
}

// Afzender is niet de besteller: korte reply plus escalatie.
async function verwerkIdentiteitMismatch(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten
): Promise<VerwerkUitkomst> {
  const regel = basisLog(mail, classificatie, order);
  // Bewust GEEN ordergegevens aan de compose meegeven: order=null.
  const invoer: OpstelInvoer = {
    mail,
    classificatie,
    order: null,
    identiteitMismatch: true,
    meerdereOrders: false,
    voorgesteldeActie: "antwoord_sturen",
    refundToegestaan: false,
    naInkoop: false,
    doel: "klant",
    afzenderNaam: config.afzenderNaam,
  };

  let antwoordTekst: string | undefined;
  let verstuurd = false;
  try {
    const uit = await conceptVoorKlant(invoer);
    if ("concept" in uit) {
      antwoordTekst = uit.concept.tekst;
      const res = await verstuurKlantAntwoord(mail, uit.concept, null);
      verstuurd = res.soort === "verstuurd";
      if (res.soort === "cap") regel.fout = `cap ${res.uitkomst.cap}`;
      if (res.soort === "mislukt") regel.fout = res.fout ?? "verzenden_mislukt";
    } else {
      regel.fout = `concept_afgekeurd: ${uit.afgekeurd}`;
    }
  } catch (err) {
    log.warn(`Identiteit-mismatch reply mislukt`, err);
    regel.fout = "reply_mislukt";
  }

  // Altijd escaleren, ongeacht of de klant-reply lukte (spec sectie 4).
  const esc = bouwEscalatie(mail, {
    reden: "identiteit_mismatch",
    toelichting: `Afzender ${mail.vanAdres} is NIET de besteller van ${order.orderToken} (${order.email}). Geen gegevens gedeeld.`,
    intent: classificatie.intent,
    vertrouwen: classificatie.vertrouwen,
    orderToken: order.orderToken,
  });
  await voerActieUit(esc);

  regel.actie = verstuurd ? "antwoord_sturen" : "escalatie_sturen";
  regel.escalatie = true;
  regel.escalatieReden = "identiteit_mismatch";
  regel.antwoordTekst = antwoordTekst;
  regel.verstuurdAt = verstuurd ? new Date().toISOString() : undefined;
  regel.bestemming = config.mappen.escalatie;
  await schrijfLog(regel);
  log.info(`Identiteit-mismatch op ${order.orderToken}, geescaleerd: ${mail.vanAdres}`);
  return { bestemming: config.mappen.escalatie, actie: regel.actie };
}

// status_vraag en product_vraag: gewoon een inhoudelijk antwoord uit de feiten.
async function verwerkKlantAntwoordIntent(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten,
  match: MatchResultaat
): Promise<VerwerkUitkomst> {
  const invoer: OpstelInvoer = {
    mail,
    classificatie,
    order,
    identiteitMismatch: false,
    meerdereOrders: match.aantalGevonden > 1,
    voorgesteldeActie: "antwoord_sturen",
    refundToegestaan: false,
    naInkoop: (NA_INKOOP_STATUSSEN as readonly string[]).includes(order.fulfilmentStatus),
    doel: "klant",
    afzenderNaam: config.afzenderNaam,
  };
  return await stelOpEnVerstuur(mail, classificatie, order, invoer);
}

// Algemene vraag zonder bestelling (product_vraag). Beantwoorden uit de
// kennisbank, zonder een enkel ordergegeven, want dat hebben we niet. Dit is de
// belangrijkste winst van 24-07: zulke mails gingen daarvoor allemaal naar Sabur.
async function verwerkAlgemeneVraag(
  mail: InkomendeMail,
  classificatie: Classificatie,
  intent: Intent
): Promise<VerwerkUitkomst> {
  // Anti-spoofing: zonder gekoppelde bestelling mailen wij alleen terug naar
  // een adres dat aantoonbaar echt is. Anders zou een vervalst From-adres ons
  // een mail naar een willekeurige derde laten sturen.
  if (!magKlantMailen(mail, false)) {
    const esc = bouwEscalatie(mail, {
      reden: "geen_order",
      toelichting: `Algemene vraag van ${mail.vanAdres}, maar het afzenderadres is NIET geauthenticeerd (geen DMARC- of DKIM-pass) en er is geen bestelling aan te koppelen. Niet automatisch beantwoord; mogelijk een vervalst adres. Beoordeel handmatig.`,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
    });
    const regel = basisLog(mail, classificatie, null);
    await escaleerNaarSabur(mail, esc, classificatie, regel, { gekoppeldeOrder: false });
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "geen_order";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = "afzender_niet_geauthenticeerd";
    await schrijfLog(regel);
    log.warn(`Algemene vraag niet beantwoord, afzender niet geauthenticeerd: ${mail.vanAdres}`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  const invoer: OpstelInvoer = {
    mail,
    classificatie,
    order: null,
    identiteitMismatch: false,
    meerdereOrders: false,
    voorgesteldeActie: "antwoord_sturen",
    refundToegestaan: false,
    naInkoop: false,
    doel: "klant",
    afzenderNaam: config.afzenderNaam,
    magOrderVragen: true,
  };
  log.info(`Algemene vraag zonder bestelling (${intent}) van ${mail.vanAdres}, zelf beantwoorden`);
  return await stelOpEnVerstuur(mail, classificatie, null, invoer);
}

// Ordergebonden vraag terwijl we de bestelling niet vinden. De bot vraagt zelf
// om het ordernummer of het kenteken. Dat doet hij per gesprek een keer; daarna
// heeft doorvragen geen zin meer en kijkt Sabur ernaar. Noemde de klant al een
// VH-nummer dat niet bestaat, dan vragen we ook niet: dan klopt er iets anders
// niet en moet een mens kijken.
async function verwerkOrderOnbekend(
  mail: InkomendeMail,
  classificatie: Classificatie,
  intent: Intent,
  match: MatchResultaat
): Promise<VerwerkUitkomst> {
  const alGevraagd = orderVraagGesteld(mail);
  const genoemdNummer = match.genoemdVhNummer;
  const magVragen =
    config.schakelaars.zelfDoorvragen && !alGevraagd && !genoemdNummer && magKlantMailen(mail, false);

  // ANNULEREN is een apart geval, en het gevaarlijkste. Twee redenen:
  //   1. Tijdkritisch. Levering duurt normaal een kwartier en Roemenie kopen we
  //      direct na de betaling in. Wacht de bot op een antwoord van de klant,
  //      dan is kosteloos annuleren intussen misschien niet meer mogelijk.
  //      Sabur moet dit dus METEEN zien en zelf op naam of kenteken kunnen
  //      zoeken, ook als de bot netjes doorvraagt.
  //   2. Geld. Bij annuleren mag er geen woord het model uit komen dat als
  //      toezegging te lezen is, dus die vraag om het ordernummer is een vaste
  //      tekst en geen modelaanroep.
  if (intent === "annuleren") {
    return await verwerkAnnuleerZonderOrder(mail, classificatie, match, { magVragen });
  }

  if (!magVragen) {
    const toelichting = genoemdNummer
      ? `De klant noemt ordernummer ${genoemdNummer}, maar die bestelling bestaat niet in de database. Handmatig beoordelen.`
      : alGevraagd
        ? "In dit gesprek al een keer om het ordernummer of kenteken gevraagd en nog steeds geen match. Handmatig beoordelen."
        : `Geen order gevonden op VH-nummer, e-mailadres of kenteken, en zelf doorvragen staat uit. Intent ${intent}.`;
    const esc = bouwEscalatie(mail, {
      reden: "geen_order",
      toelichting,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
    });
    const regel = basisLog(mail, classificatie, null);
    await escaleerNaarSabur(mail, esc, classificatie, regel);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "geen_order";
    regel.bestemming = config.mappen.escalatie;
    await schrijfLog(regel);
    log.info(`Geen order gevonden, geescaleerd: ${mail.vanAdres}`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  const invoer: OpstelInvoer = {
    mail,
    classificatie,
    order: null,
    identiteitMismatch: false,
    meerdereOrders: false,
    voorgesteldeActie: "antwoord_sturen",
    refundToegestaan: false,
    naInkoop: false,
    doel: "klant",
    afzenderNaam: config.afzenderNaam,
    magOrderVragen: true,
  };
  log.info(`Bestelling niet gevonden (${intent}), zelf om ordernummer vragen: ${mail.vanAdres}`);
  const uitkomst = await stelOpEnVerstuur(mail, classificatie, null, invoer);
  // Alleen tellen als de vraag echt de deur uit is; anders mag de volgende mail
  // in deze thread het gewoon nog een keer proberen.
  if (uitkomst.actie === "antwoord_sturen") {
    registreerOrderVraag(mail);
  }
  return uitkomst;
}

// Annuleerverzoek waarvan wij de bestelling niet kunnen vinden. Sabur krijgt
// ALTIJD een escalatie (tijdkritisch), en de klant krijgt daarnaast een vaste
// tekst met de vraag om zijn ordernummer. Die tekst komt niet uit het model:
// bij geld wordt niets geformuleerd wat als toezegging te lezen valt.
async function verwerkAnnuleerZonderOrder(
  mail: InkomendeMail,
  classificatie: Classificatie,
  match: MatchResultaat,
  opts: { magVragen: boolean }
): Promise<VerwerkUitkomst> {
  const regel = basisLog(mail, classificatie, null);
  const genoemdNummer = match.genoemdVhNummer;

  const esc = bouwEscalatie(mail, {
    reden: "geen_order",
    toelichting: genoemdNummer
      ? `ANNULEERVERZOEK van ${mail.vanAdres} met ordernummer ${genoemdNummer}, maar die bestelling bestaat niet in de database. TIJDKRITISCH: zoek zelf op naam, kenteken of e-mailadres voordat er ingekocht wordt.`
      : `ANNULEERVERZOEK van ${mail.vanAdres}, maar er is geen bestelling te vinden op dit e-mailadres. TIJDKRITISCH: zoek zelf op naam of kenteken voordat er ingekocht wordt. De bot heeft de klant om zijn ordernummer gevraagd, maar niets bevestigd en niets terugbetaald.`,
    spoed: true,
    intent: classificatie.intent,
    vertrouwen: classificatie.vertrouwen,
  });
  // Bewust NIET via escaleerNaarSabur: de standaard-ontvangstbevestiging is
  // hier verkeerd, want de klant moet iets DOEN (zijn ordernummer sturen).
  await voerActieUit(esc);

  let verstuurd = false;
  if (opts.magVragen && magVersturen() && magKlantMailen(mail, false)) {
    const cap = magAntwoorden(mail, { stil: true });
    if (!cap.geblokkeerd) {
      const taal = taalVan(classificatie);
      const concept: Concept = {
        onderwerp: reOnderwerpVan(mail, taal),
        tekst: metOndertekening(
          kiesTekst(ANNULEER_ORDERVRAAG_TEKST, taal),
          config.afzenderNaam,
          merkNaam()
        ),
        taal: naarLocale(taal),
      };
      const res = await voerActieUit(bouwAntwoordOpdracht(mail, concept));
      if (res.ok && res.uitgevoerd) {
        registreerAntwoord(mail);
        registreerOrderVraag(mail);
        verstuurd = true;
        regel.antwoordTekst = concept.tekst;
        regel.verstuurdAt = new Date().toISOString();
      } else {
        log.warn(`Ordervraag bij annuleren niet verstuurd: ${res.fout ?? "onbekend"}`);
      }
    }
  }

  regel.actie = "escalatie_sturen";
  regel.escalatie = true;
  regel.escalatieReden = "geen_order";
  regel.bestemming = config.mappen.escalatie;
  regel.melding = verstuurd ? "klant om ordernummer gevraagd (vaste tekst)" : "klant niets gestuurd";
  await schrijfLog(regel);
  log.warn(`ANNULEERVERZOEK zonder bestelling van ${mail.vanAdres}, geescaleerd met spoed`);
  return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
}

// kenteken_fout: voor inkoop uitleg plus link naar zelf corrigeren; na inkoop
// niets, escaleren met het foutNaInkoop-runbook (spec sectie 5).
async function verwerkKentekenFout(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten,
  match: MatchResultaat
): Promise<VerwerkUitkomst> {
  const naInkoop = (NA_INKOOP_STATUSSEN as readonly string[]).includes(order.fulfilmentStatus);
  if (naInkoop) {
    const esc = bouwEscalatie(mail, {
      reden: "kenteken_fout_na_inkoop",
      toelichting: `Kentekenfout gemeld op ${order.orderToken}, status ${order.fulfilmentStatus}. Het vignet staat al op het kenteken; volg het foutNaInkoop-runbook voor ${order.land}.`,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order.orderToken,
    });
    const regel = basisLog(mail, classificatie, order);
    await escaleerNaarSabur(mail, esc, classificatie, regel);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "kenteken_fout_na_inkoop";
    regel.bestemming = config.mappen.escalatie;
    await schrijfLog(regel);
    log.info(`Kenteken_fout na inkoop op ${order.orderToken}, geescaleerd`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  const invoer: OpstelInvoer = {
    mail,
    classificatie,
    order,
    identiteitMismatch: false,
    meerdereOrders: match.aantalGevonden > 1,
    voorgesteldeActie: "antwoord_sturen",
    refundToegestaan: false,
    naInkoop: false,
    doel: "klant",
    afzenderNaam: config.afzenderNaam,
  };
  return await stelOpEnVerstuur(mail, classificatie, order, invoer);
}

// annuleren: het enige geldpad (spec sectie 6).
async function verwerkAnnuleren(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten,
  match: MatchResultaat
): Promise<VerwerkUitkomst> {
  // Poort 1: betaling moet COMPLETED zijn.
  if (order.betaalStatus !== "COMPLETED") {
    return await escaleerAnnuleren(
      mail,
      classificatie,
      order,
      "status_niet_toegestaan",
      `Annuleerverzoek op ${order.orderToken}, maar betaling is ${order.betaalStatus}. Geen voltooide bestelling om terug te betalen.`
    );
  }

  // Na inkoop (PURCHASED of DELIVERED): geen refund, operator-doorverwijzing
  // (spec sectie 6, autonoom antwoord).
  if ((NA_INKOOP_STATUSSEN as readonly string[]).includes(order.fulfilmentStatus)) {
    const invoer: OpstelInvoer = {
      mail,
      classificatie,
      order,
      identiteitMismatch: false,
      meerdereOrders: match.aantalGevonden > 1,
      voorgesteldeActie: "antwoord_sturen",
      refundToegestaan: false,
      naInkoop: true,
      doel: "klant",
      afzenderNaam: config.afzenderNaam,
    };
    return await stelOpEnVerstuur(mail, classificatie, order, invoer);
  }

  // Poort 2: alleen QUEUED of SCHEDULED gaat naar de refund. De rest
  // (NEEDS_ACTION, CANCELLED, REFUNDED) gaat naar Sabur.
  if (!(REFUNDBARE_STATUSSEN as readonly string[]).includes(order.fulfilmentStatus)) {
    return await escaleerAnnuleren(
      mail,
      classificatie,
      order,
      "status_niet_toegestaan",
      `Annuleerverzoek op ${order.orderToken}, status ${order.fulfilmentStatus}. Niet automatisch te annuleren.`
    );
  }

  // Vanaf hier: QUEUED of SCHEDULED, betaling COMPLETED, identiteit klopt.
  return await voerRefundUit(mail, classificatie, order);
}

// De daadwerkelijke refund-flow (spec sectie 6). Bedrag ALTIJD volledig:
// totaal min al terugbetaald, nooit uit de mail.
async function voerRefundUit(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten
): Promise<VerwerkUitkomst> {
  const regel = basisLog(mail, classificatie, order);
  const teRefundenCents = Math.max(0, order.totaalCents - order.alTerugbetaaldCents);

  // Anti-spoofing (spec sectie 4): het From-adres is zonder authenticatie te
  // vervalsen. Zonder DMARC/DKIM-bewijs NOOIT een autonome refund, anders kan
  // iemand met een vervalst From-adres andermans vignet laten intrekken. Wel
  // escaleren, zodat Sabur het met de hand kan verifieren.
  if (!mail.afzenderGeauthenticeerd) {
    const esc = bouwEscalatie(mail, {
      reden: "identiteit_mismatch",
      toelichting: `Annuleerverzoek op ${order.orderToken}, maar het afzenderadres (${mail.vanAdres}) is NIET geauthenticeerd (geen DMARC- of DKIM-pass op het From-domein). Mogelijk een vervalst From-adres. Verifieer handmatig voordat je annuleert of terugbetaalt.`,
      spoed: true,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order.orderToken,
    });
    await voerActieUit(esc);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "identiteit_mismatch";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = "afzender_niet_geauthenticeerd";
    await schrijfLog(regel);
    log.warn(`Refund ${order.orderToken} geblokkeerd: afzender niet geauthenticeerd (${mail.vanAdres})`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  // Schakelaar REFUND uit: niet terugbetalen, wel escaleren.
  if (!magRefunden()) {
    const esc = bouwEscalatie(mail, {
      reden: "actie_mislukt",
      toelichting: `Annuleerverzoek op ${order.orderToken} (${order.fulfilmentStatus}), maar MAILBOT_REFUND staat uit. Handmatig annuleren en terugbetalen.`,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order.orderToken,
    });
    await escaleerNaarSabur(mail, esc, classificatie, regel);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "actie_mislukt";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = "refund_schakelaar_uit";
    await schrijfLog(regel);
    log.warn(`MAILBOT_REFUND uit; ${order.orderToken} geescaleerd`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  // Refund-caps (aantal per dag en euro per dag).
  const cap = magRefunderen(teRefundenCents);
  if (cap.geblokkeerd) {
    if (cap.meldSabur) {
      const esc = bouwEscalatie(mail, {
        reden: "cap_bereikt",
        toelichting: `Refund-cap bereikt (${cap.cap}): ${cap.detail}. De bot stopt met refunds tot morgen; handmatig afhandelen.`,
        spoed: true,
        intent: classificatie.intent,
        vertrouwen: classificatie.vertrouwen,
        orderToken: order.orderToken,
      });
      await voerActieUit(esc);
    }
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "cap_bereikt";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = cap.cap;
    await schrijfLog(regel);
    log.warn(`Refund geblokkeerd door cap ${cap.cap}: ${order.orderToken}`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  // De actie zelf. De app doet de volledige flow: status atomisch omzetten,
  // dan refunden, dan de klantmail via sendCancellationMail (spec sectie 6).
  const res = await voerActieUit({
    actie: "annuleer_refund",
    botMailId: mail.botMailId,
    orderToken: order.orderToken,
    verwachtBedragCents: teRefundenCents,
    afzender: mail.vanAdres,
  });

  // Onbekende uitkomst (time-out of 5xx): NOOIT opnieuw proberen bij een
  // geldactie. Escaleren zodat Sabur PayPal en de order controleert.
  if (!res.definitief) {
    const esc = bouwEscalatie(mail, {
      reden: "actie_onbekend",
      toelichting: `Refund op ${order.orderToken} gaf een ONBEKENDE uitkomst (${res.fout ?? "time-out/5xx"}). NIET automatisch opnieuw gedaan. Controleer PayPal en de orderstatus handmatig.`,
      spoed: true,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order.orderToken,
    });
    // De klant hoort wel dat zijn mail binnen is, maar de vaste tekst belooft
    // niets over geld: wat er met de terugbetaling is gebeurd weet niemand nog.
    await escaleerNaarSabur(mail, esc, classificatie, regel);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "actie_onbekend";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = res.fout ?? "onbekend";
    await schrijfLog(regel);
    log.fout(`Refund ${order.orderToken} ONBEKENDE uitkomst, geescaleerd`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  // Definitief geweigerd (bijv. status intussen naar PURCHASED gesprongen):
  // er is niets gebeurd. Escaleren zodat een mens beslist.
  if (!res.ok || !res.uitgevoerd) {
    // Idempotent hergebruik: deze mail was al eerder verwerkt. Niets dubbels doen.
    if (res.idempotentHergebruik) {
      regel.actie = "annuleer_refund";
      regel.bestemming = config.mappen.afgehandeld;
      regel.melding = "al eerder verwerkt (idempotent)";
      await schrijfLog(regel);
      log.info(`Refund ${order.orderToken} al eerder verwerkt, gearchiveerd`);
      return { bestemming: config.mappen.afgehandeld, actie: "annuleer_refund" };
    }
    const esc = bouwEscalatie(mail, {
      reden: "status_niet_toegestaan",
      toelichting: `Refund op ${order.orderToken} werd geweigerd (${res.fout ?? "status gewijzigd"}). Waarschijnlijk is de order intussen ingekocht. Handmatig beoordelen.`,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order.orderToken,
    });
    await escaleerNaarSabur(mail, esc, classificatie, regel);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "status_niet_toegestaan";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = res.fout;
    await schrijfLog(regel);
    log.warn(`Refund ${order.orderToken} geweigerd (${res.fout}), geescaleerd`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  // Gelukt. Cap-tellers bijwerken en de LUIDE melding aan Sabur sturen
  // (spec sectie 6, stap 4). De klant heeft de annuleringsmail al van de app
  // gekregen (stap 3), dus geen aparte reply.
  const refundCents = res.refundCents ?? teRefundenCents;
  if (!res.idempotentHergebruik) {
    registreerRefund(refundCents);
    const euro = (refundCents / 100).toFixed(2);
    const melding = bouwEscalatie(mail, {
      reden: "refund_uitgevoerd",
      toelichting: `${order.orderToken} GEANNULEERD EN TERUGBETAALD (${euro} EUR). NIET INKOPEN. De klant heeft de annuleringsmail ontvangen.`,
      spoed: true,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order.orderToken,
    });
    await voerActieUit(melding);
  }

  regel.actie = "annuleer_refund";
  regel.escalatie = false;
  regel.verstuurdAt = new Date().toISOString();
  regel.bestemming = config.mappen.afgehandeld;
  regel.melding = res.melding ?? `terugbetaald ${(refundCents / 100).toFixed(2)} EUR`;
  await schrijfLog(regel);
  log.info(`Refund ${order.orderToken} gelukt (${(refundCents / 100).toFixed(2)} EUR), Sabur geinformeerd`);
  return { bestemming: config.mappen.afgehandeld, actie: "annuleer_refund" };
}

// ---------------------------------------------------------------------------
// Gedeelde helpers voor de deelroutes
// ---------------------------------------------------------------------------

// Concept opstellen, controleren en versturen naar de klant, met alle
// uitkomsten netjes gelogd. Gebruikt door status/product/kenteken/annuleren-na-inkoop.
async function stelOpEnVerstuur(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten | null,
  invoer: OpstelInvoer
): Promise<VerwerkUitkomst> {
  const regel = basisLog(mail, classificatie, order);
  // Zonder bestelling is er niets om naar te verwijzen in de log en de melding.
  const waarover = order ? order.orderToken : "een vraag zonder bestelling";

  // Cap VOOR het opstellen toetsen. Zit hij dicht, dan mag het antwoord toch
  // niet weg en zou een modelaanroep alleen geld kosten. Bij een mailstorm
  // scheelt dat het verschil tussen een rekening en geen rekening.
  const capVooraf = magAntwoorden(mail, { stil: true });
  if (capVooraf.geblokkeerd) {
    // Nu wel de echte toets, zodat Sabur zijn eenmalige cap-melding krijgt.
    return await capGeblokkeerd(mail, classificatie, order, magAntwoorden(mail));
  }

  let uit: { concept: Concept } | { afgekeurd: string };
  try {
    uit = await conceptVoorKlant(invoer);
  } catch (err) {
    // Opstellen of controleren gooide: escaleren met de ruwe mail.
    log.warn(`Opstellen mislukt voor ${mail.botMailId}`, err);
    return await escaleerNaMislukking(mail, classificatie, order, regel, "opstellen_mislukt");
  }

  // Controle afgekeurd (spec sectie 8: weigeren en escaleren).
  if ("afgekeurd" in uit) {
    const esc = bouwEscalatie(mail, {
      reden: "controle_afgekeurd",
      toelichting: `Concept afgekeurd door de controle (${uit.afgekeurd}). Handmatig beantwoorden.`,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order?.orderToken,
    });
    await escaleerNaarSabur(mail, esc, classificatie, regel);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "controle_afgekeurd";
    regel.bestemming = config.mappen.escalatie;
    regel.fout = uit.afgekeurd;
    await schrijfLog(regel);
    log.warn(`Concept afgekeurd voor ${waarover}: ${uit.afgekeurd}`);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  const concept = uit.concept;
  regel.antwoordTekst = concept.tekst;
  regel.kostenUsd = (classificatie.kostenUsd ?? 0) + (concept.kostenUsd ?? 0);

  const res = await verstuurKlantAntwoord(mail, concept, order);
  if (res.soort === "verstuurd") {
    regel.actie = "antwoord_sturen";
    regel.verstuurdAt = new Date().toISOString();
    regel.bestemming = config.mappen.afgehandeld;
    await schrijfLog(regel);
    log.info(`Antwoord verstuurd op ${waarover} (${concept.taal})`);
    return { bestemming: config.mappen.afgehandeld, actie: "antwoord_sturen" };
  }

  if (res.soort === "cap") {
    return await capGeblokkeerd(mail, classificatie, order, res.uitkomst, concept);
  }

  if (res.soort === "send_uit") {
    // SEND uit: escaleren met concept zodat Sabur het handmatig kan versturen.
    const esc = bouwEscalatie(mail, {
      reden: "verzending_uit",
      toelichting: `MAILBOT_SEND staat uit. Concept-antwoord voor ${waarover} handmatig versturen.`,
      concept,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order?.orderToken,
    });
    await voerActieUit(esc);
    regel.actie = "escalatie_sturen";
    regel.escalatie = true;
    regel.escalatieReden = "verzending_uit";
    regel.bestemming = config.mappen.escalatie;
    await schrijfLog(regel);
    return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
  }

  // Verzenden mislukt.
  return await escaleerNaMislukking(mail, classificatie, order, regel, res.fout ?? "verzenden_mislukt", concept);
}

// Cap dichtgeslagen op een antwoord: escaleren als het de eerste keer is, en de
// mail naar Escalatie zodat Sabur hem alsnog beantwoordt.
async function capGeblokkeerd(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten | null,
  cap: CapUitkomst,
  concept?: Concept
): Promise<VerwerkUitkomst> {
  if (cap.meldSabur) {
    const esc = bouwEscalatie(mail, {
      reden: "cap_bereikt",
      toelichting: `Antwoord-cap bereikt (${cap.cap}): ${cap.detail}. De bot stopt met deze categorie tot morgen; handmatig afhandelen.`,
      spoed: true,
      concept,
      intent: classificatie.intent,
      vertrouwen: classificatie.vertrouwen,
      orderToken: order?.orderToken,
    });
    await voerActieUit(esc);
  }
  const regel = basisLog(mail, classificatie, order);
  regel.actie = "escalatie_sturen";
  regel.escalatie = true;
  regel.escalatieReden = "cap_bereikt";
  regel.bestemming = config.mappen.escalatie;
  regel.fout = cap.cap;
  if (concept) regel.antwoordTekst = concept.tekst;
  await schrijfLog(regel);
  log.warn(`Antwoord geblokkeerd door cap ${cap.cap}: ${mail.vanAdres}`);
  return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
}

// Generieke escalatie na een mislukte stap, met een al deels gevulde logregel.
async function escaleerNaMislukking(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten | null,
  regel: MailBotLogRegel,
  fout: string,
  concept?: Concept
): Promise<VerwerkUitkomst> {
  const esc = bouwEscalatie(mail, {
    reden: "actie_mislukt",
    toelichting: `Verwerking van ${order?.orderToken ?? "een mail zonder bestelling"} mislukte (${fout}). Handmatig afhandelen.`,
    concept,
    intent: classificatie.intent,
    vertrouwen: classificatie.vertrouwen,
    orderToken: order?.orderToken,
  });
  await escaleerNaarSabur(mail, esc, classificatie, regel);
  regel.actie = "escalatie_sturen";
  regel.escalatie = true;
  regel.escalatieReden = "actie_mislukt";
  regel.bestemming = config.mappen.escalatie;
  regel.fout = fout;
  await schrijfLog(regel);
  return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
}

// Escalatie op het annuleerpad, met een vaste reden en toelichting.
async function escaleerAnnuleren(
  mail: InkomendeMail,
  classificatie: Classificatie,
  order: OrderFeiten,
  reden: EscalatieReden,
  toelichting: string
): Promise<VerwerkUitkomst> {
  const esc = bouwEscalatie(mail, {
    reden,
    toelichting,
    intent: classificatie.intent,
    vertrouwen: classificatie.vertrouwen,
    orderToken: order.orderToken,
  });
  const regel = basisLog(mail, classificatie, order);
  await escaleerNaarSabur(mail, esc, classificatie, regel);
  regel.actie = "escalatie_sturen";
  regel.escalatie = true;
  regel.escalatieReden = reden;
  regel.bestemming = config.mappen.escalatie;
  await schrijfLog(regel);
  log.info(`Annuleren geescaleerd (${reden}): ${order.orderToken}`);
  return { bestemming: config.mappen.escalatie, actie: "escalatie_sturen" };
}

// ---------------------------------------------------------------------------
// Poll-ronde
// ---------------------------------------------------------------------------

// Verplaatst een mail veilig, met een korte herkansing. Lukt het echt niet, dan
// loggen we het maar leggen de lus niet stil; de \Seen-vlag die afhandelen als
// eerste zet voorkomt dat de mail opnieuw wordt opgehaald.
async function veiligVerplaats(postbus: Postbus, uid: number, bestemming: string): Promise<void> {
  for (let poging = 1; poging <= 2; poging++) {
    try {
      await postbus.afhandelen(uid, bestemming);
      return;
    } catch (err) {
      log.warn(`Verplaatsen uid ${uid} naar ${bestemming} mislukte (poging ${poging})`, err);
      if (poging === 2) return;
    }
  }
}

async function pollRonde(postbus: Postbus): Promise<void> {
  if (!magVerwerken()) {
    log.info("MAILBOT_ENABLED staat uit, ronde overgeslagen");
    return;
  }

  const mails = await postbus.haalOngelezen();
  if (mails.length === 0) {
    log.debug("Geen ongelezen mails");
    return;
  }
  log.info(`${mails.length} ongelezen mail(s) te verwerken`);

  for (const ruw of mails) {
    // Parsen. Lukt dat niet, dan naar Bot/Fout.
    let mail: InkomendeMail;
    try {
      mail = await parseMail(ruw.uid, ruw.ruw);
    } catch (err) {
      log.fout(`Parsen mislukt voor uid ${ruw.uid}, naar Bot/Fout`, err);
      await veiligVerplaats(postbus, ruw.uid, config.mappen.fout);
      continue;
    }

    // Verwerken. UitstelFout = laten staan; andere fout = Bot/Fout.
    try {
      const uitkomst = await verwerkMail(mail);
      await veiligVerplaats(postbus, ruw.uid, uitkomst.bestemming);
    } catch (err) {
      if (err instanceof UitstelFout) {
        log.warn(`Mail ${mail.botMailId} uitgesteld: ${err.message}`);
        continue; // niet verplaatsen, volgende ronde opnieuw
      }
      log.fout(`Verwerken ${mail.botMailId} crashte, naar Bot/Fout`, err);
      // Best effort foutregel.
      await schrijfLog({
        botMailId: mail.botMailId,
        ontvangenAt: mail.ontvangenAt.toISOString(),
        van: mail.vanAdres,
        onderwerp: mail.onderwerp,
        actie: "geen",
        escalatie: false,
        escalatieReden: "verwerkingsfout",
        fout: err instanceof Error ? err.message : String(err),
        bestemming: config.mappen.fout,
      });
      await veiligVerplaats(postbus, ruw.uid, config.mappen.fout);
    }
  }
}

// ---------------------------------------------------------------------------
// Opstarten
// ---------------------------------------------------------------------------

function slaap(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Draait de bot als continue lus tot een noodstop.
async function draaiContinu(postbus: Postbus): Promise<void> {
  let stoppen = false;
  const stop = async (signaal: string) => {
    if (stoppen) return;
    stoppen = true;
    log.info(`${signaal} ontvangen, netjes afsluiten`);
    await postbus.sluit();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  log.info(
    `Mailbot gestart. poll=${config.poll.seconden}s, ENABLED=${config.schakelaars.enabled}, ` +
      `SEND=${config.schakelaars.send}, REFUND=${config.schakelaars.refund}, afzender=${config.afzenderNaam}`
  );

  while (!stoppen) {
    try {
      await pollRonde(postbus);
    } catch (err) {
      // Een fout op ronde-niveau (bijv. verbinding weg) mag de lus niet stoppen.
      log.fout("Poll-ronde faalde, doorgaan na wachttijd", err);
    }
    if (stoppen) break;
    await slaap(config.poll.seconden * 1000);
  }
}

// Draait exact een ronde en stopt (handig om te testen).
async function draaiEenmalig(postbus: Postbus): Promise<void> {
  log.info("Mailbot eenmalige modus: een ronde en dan stoppen");
  await pollRonde(postbus);
  await postbus.sluit();
  log.info("Eenmalige ronde klaar");
}

async function main(): Promise<void> {
  const eenmalig = process.argv.includes("--eenmalig") || (process.env.EENMALIG ?? "").trim() === "1";
  const postbus = new Postbus();
  // Eerst zeker verbinden (met backoff), zodat mappen bestaan voor we pollen.
  await postbus.zorgVerbonden();

  if (eenmalig) {
    await draaiEenmalig(postbus);
    process.exit(0);
  }
  await draaiContinu(postbus);
}

main().catch((err) => {
  log.fout("Fatale fout in main, proces stopt", err);
  process.exit(1);
});
