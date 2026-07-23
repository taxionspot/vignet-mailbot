// Gedeelde contracten van de VignetteHub mailbot.
//
// Dit bestand is het koppelvlak tussen de vier bouwers. De lus in src/index.ts
// importeert vier functies uit modules die hier NIET staan, en verwacht exact
// de handtekeningen die onderaan dit bestand als *Fn-types staan:
//
//   src/classify.ts   export const classificeer: ClassificeerFn
//   src/compose.ts    export const stelOp: StelOpFn
//   src/verify.ts     export const controleerConcept: ControleerConceptFn
//   src/acties.ts     export const voerActieUit: VoerActieUitFn
//
// (Een gewone `export async function classificeer(mail: InkomendeMail):
// Promise<Classificatie>` voldoet net zo goed, als de vorm maar klopt.)
//
// Het project draait als ESM met moduleResolution NodeNext. Relatieve imports
// MOETEN daarom eindigen op .js, ook als het bronbestand .ts heet:
//   import { classificeer } from "./classify.js";
//
// Bron van waarheid voor het gedrag: docs/MAILBOT-SPEC-2026-07-23.md in de
// app-repo (sites/vignet-mvp).

// ---------------------------------------------------------------------------
// Basistypen, gelijk gehouden met de app
// ---------------------------------------------------------------------------

/** De elf talen die live staan (lib/i18n/catalog.ts in de app). */
export const LOCALES = ["nl", "de", "fr", "en", "pl", "it", "ro", "cs", "hu", "es", "tr"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(waarde: unknown): waarde is Locale {
  return typeof waarde === "string" && (LOCALES as readonly string[]).includes(waarde);
}

/** Onbekende of lege taal valt terug op Nederlands, net als emailLocale() in de app. */
export function naarLocale(ruw: unknown): Locale {
  const s = typeof ruw === "string" ? ruw.trim().toLowerCase() : "";
  return isLocale(s) ? s : "nl";
}

/** De zes landen die wij verkopen (lib/vignet/config.ts). */
export const LANDCODES = ["at", "ch", "cz", "sk", "ro", "bg"] as const;
export type LandCode = (typeof LANDCODES)[number];

/** Fulfilment-statusmachine uit models/VignetteOrder.ts. */
export type FulfilmentStatus =
  | "QUEUED"
  | "SCHEDULED"
  | "PURCHASED"
  | "DELIVERED"
  | "NEEDS_ACTION"
  | "CANCELLED"
  | "REFUNDED";

/** Betaalstatus uit models/VignetteOrder.ts. */
export type PaymentStatus = "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";

/** De enige twee statussen waarbij een refund door de bot mag (spec sectie 6). */
export const REFUNDBARE_STATUSSEN: readonly FulfilmentStatus[] = ["QUEUED", "SCHEDULED"];

/** Statussen waarbij het vignet al op het kenteken staat (operator-doorverwijzing). */
export const NA_INKOOP_STATUSSEN: readonly FulfilmentStatus[] = ["PURCHASED", "DELIVERED"];

// ---------------------------------------------------------------------------
// Intents (spec sectie 5)
// ---------------------------------------------------------------------------

export const INTENTS = [
  "status_vraag",
  "annuleren",
  "bewijs_kwijt",
  "product_vraag",
  "kenteken_fout",
  "factuur",
  "betaling_probleem",
  "klacht_juridisch",
  "spam_overig",
  "mens_nodig",
] as const;
export type Intent = (typeof INTENTS)[number];

export function isIntent(waarde: unknown): waarde is Intent {
  return typeof waarde === "string" && (INTENTS as readonly string[]).includes(waarde);
}

/**
 * Intents die de bot nooit zelf afhandelt. kenteken_fout staat hier NIET in:
 * die mag autonoom zolang de order nog niet is ingekocht, daarna escaleert de
 * lus hem alsnog (spec sectie 5).
 */
export const ESCALATIE_INTENTS: readonly Intent[] = [
  "factuur",
  "betaling_probleem",
  "klacht_juridisch",
  "mens_nodig",
];

/**
 * Intents die zonder gevonden bestelling niet zinnig te beantwoorden zijn. Bij
 * deze vier vraagt de bot eerst zelf om het ordernummer of het kenteken in
 * plaats van meteen naar Sabur te escaleren (besluit Sabur 24-07).
 *
 * product_vraag staat hier bewust NIET in: een algemene vraag over een vignet,
 * een land of de geldigheid is prima te beantwoorden uit de kennisbank, ook
 * zonder bestelling. Dat was voor 24-07 de grootste bron van onnodige
 * escalaties.
 *
 * Deze lijst is de enige bron van waarheid; compose.ts leest hem mee.
 */
export const ORDER_GEBONDEN_INTENTS: readonly Intent[] = [
  "status_vraag",
  "annuleren",
  "bewijs_kwijt",
  "kenteken_fout",
];

// ---------------------------------------------------------------------------
// Inkomende mail
// ---------------------------------------------------------------------------

/** Headers die de lus-beveiliging nodig heeft (spec sectie 9). */
export interface MailHeaders {
  /** Auto-Submitted: alles behalve "no" betekent machinepost. */
  autoSubmitted: string | null;
  /** X-Autoreply / X-Auto-Response-Suppress / X-Autorespond. */
  autoreply: string | null;
  /** Precedence: bulk, junk, list of auto_reply. */
  precedence: string | null;
  /** List-Id of List-Unsubscribe: mailinglijst, nooit op antwoorden. */
  listId: string | null;
  listUnsubscribe: string | null;
  /** Return-Path; leeg (<>) hoort bij bounces. */
  returnPath: string | null;
  /** X-Failed-Recipients staat alleen op bounces. */
  failedRecipients: string | null;
  /** Content-Type, ruw. multipart/report duidt op een DSN. */
  contentType: string | null;
  /** Alle overige headers, kleine letters als sleutel, ruwe waarde. */
  overig: Record<string, string>;
}

/** Een binnengekomen mail, volledig geparseerd. */
export interface InkomendeMail {
  /** IMAP UID in INBOX, alleen geldig binnen deze poll-ronde. */
  uid: number;
  /**
   * Unieke sleutel voor idempotentie, komt uit de Message-ID. Ontbreekt die,
   * dan een hash over afzender, onderwerp en ontvangsttijd. Dit is de waarde
   * die als botMailId naar /api/bot/actie en /api/bot/log gaat.
   */
  botMailId: string;
  /** Ruwe Message-ID inclusief punthaken, null als de mail er geen had. */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Sleutel waarop de thread-cap telt (eerste referentie, anders eigen id). */
  threadSleutel: string;
  /** Afzenderadres, kleine letters en getrimd. Leeg als er geen adres was. */
  vanAdres: string;
  vanNaam: string;
  /**
   * True als het From-adres aantoonbaar echt is: de ontvangende server (Zoho)
   * meldde DMARC-pass, of DKIM-pass uitgelijnd op het From-domein. Zonder deze
   * waarde is het From-adres te vervalsen, en mag er GEEN autonome geldactie op
   * gebaseerd worden (spec sectie 4, anti-spoofing). Ontbreekt de
   * Authentication-Results-header, dan false (fail-closed).
   */
  afzenderGeauthenticeerd: boolean;
  /** Alle geadresseerden uit To en Cc, kleine letters. */
  aanAdressen: string[];
  onderwerp: string;
  /** Platte tekst inclusief aangehaalde geschiedenis. Hierop zoeken we VH-nummers. */
  tekstVolledig: string;
  /** Platte tekst zonder citaat en zonder handtekeningblok. Dit gaat naar het model. */
  tekstSchoon: string;
  ontvangenAt: Date;
  headers: MailHeaders;
  bijlageNamen: string[];
  /** True als de mail eruitziet als een bounce of DSN (alleen loggen). */
  isBounce: boolean;
}

// ---------------------------------------------------------------------------
// Feitenset uit de database (GET /api/bot/order)
// ---------------------------------------------------------------------------

/**
 * De enige feiten die de bot over een bestelling kent. Alles komt server-side
 * uit MongoDB. Bewust NIET aanwezig, want klant-onveilig: payerNaam,
 * payerAdres, payerEmail, officieelCents, serviceCents, proofNote, captureId,
 * paypalOrderId, gclid en het volledige refund-dossier. Ook het statusToken
 * zit hier niet in: de app levert de kant-en-klare statusUrl.
 */
export interface OrderFeiten {
  /** VH-XXXXX, het nummer dat de klant kent. */
  orderToken: string;
  /** Volledige statuslink, https://vignettehub.com/status/<statusToken>. */
  statusUrl: string;
  /** order.email, kleine letters. Alleen voor de identiteitsregel. */
  email: string;
  land: LandCode;
  /** Landnaam in de taal van de klant, bijvoorbeeld Oostenrijk. */
  landNaam: string;
  /** ASFINAG, BAZG, edalnice.gov.cz, eznamka.sk, CNAIR, BG Toll. */
  portaalNaam: string;
  /** Inkooplink van het portaal. Alleen noemen bij de operator-doorverwijzing. */
  portaalUrl: string;
  /** Publieke controlelink van het portaal, altijd veilig om te delen. */
  checkUrl: string;
  /** Normale doorlooptijd in minuten (land.levertijdMin). */
  levertijdMinuten: number;
  productId: string;
  /** Leesbare productnaam in de taal van de klant. */
  productNaam: string;
  /** Kenteken zoals op het bord, met streepjes. */
  plateWeergave: string;
  /** ISO alpha-2 van het land van registratie, kan ontbreken. */
  plateCountry?: string;
  /** Chassisnummer, alleen bij Roemenie. */
  vin?: string;
  /** Ingangsdatum als YYYY-MM-DD. */
  startDatum: string;
  spoed: boolean;
  /** Totaalbedrag in centen. Het ENIGE bedrag dat de klant mag horen. */
  totaalCents: number;
  /** Bedrag als kant-en-klare tekst, bijvoorbeeld "34,95 EUR". */
  bedragWeergave: string;
  valuta: "EUR" | "PLN";
  /** Werkelijk afgeschreven bedrag bij een PLN-order. */
  chargeCents?: number;
  betaalStatus: PaymentStatus;
  /** ideal, mastercard, visa, paypal, applepay, bancontact. */
  betaalMethode?: string;
  /** ISO-tijd van de betaling. */
  betaaldAt?: string;
  fulfilmentStatus: FulfilmentStatus;
  /** Geplande inkoopdatum bij SCHEDULED (CH). */
  geplandeInkoopDatum?: string;
  ingekochtAt?: string;
  geleverdAt?: string;
  /** True zodra de order DELIVERED is en het bewijs-PDF bestaat. */
  bewijsBeschikbaar: boolean;
  /** Al terugbetaald in centen. Het te refunden bedrag is totaalCents min dit. */
  alTerugbetaaldCents: number;
  /** Taal waarin de klant besteld heeft. */
  uiLocale: Locale;
  aangemaaktAt: string;
}

/** Antwoord van GET /api/bot/order. */
export interface BotOrderAntwoord {
  ok: boolean;
  order?: OrderFeiten;
  /** Hoeveel orders er op deze zoekvraag pasten. >1 = de nieuwste is gekozen. */
  aantalGevonden?: number;
  error?: string;
}

/** Zoekvraag voor GET /api/bot/order. Precies een van de drie velden invullen. */
export type OrderZoek =
  | { soort: "token"; token: string }
  | { soort: "email"; email: string }
  | { soort: "plaat"; plaat: string };

// ---------------------------------------------------------------------------
// Classificatie (LLM-aanroep 1, claude-haiku-4-5)
// ---------------------------------------------------------------------------

export interface Classificatie {
  intent: Intent;
  taal: Locale;
  /** 0 tot 1. Onder de drempel uit config gaat het naar mens_nodig. */
  vertrouwen: number;
  /** Maximaal een regel. Geen bedragen, geen adressen, geen acties. */
  samenvatting: string;
  /** Kosten van deze aanroep, voor de MailBotLog. */
  kostenUsd?: number;
  /** Het gebruikte model, puur voor de logregel. */
  model?: string;
}

// ---------------------------------------------------------------------------
// Opstellen (LLM-aanroep 2, claude-sonnet-5)
// ---------------------------------------------------------------------------

/** Voor wie het concept bedoeld is. */
export type ConceptDoel = "klant" | "escalatie";

/**
 * Alles wat de opsteller mag weten. Er zit bewust geen ruwe order in: alleen
 * OrderFeiten, en die is null zodra de identiteit niet klopt.
 */
export interface OpstelInvoer {
  mail: InkomendeMail;
  classificatie: Classificatie;
  /**
   * De feitenset, of null. null betekent: geen order gevonden, of de afzender
   * is niet de besteller. In dat geval mag er GEEN enkel ordergegeven in de
   * tekst staan, ook geen status.
   */
  order: OrderFeiten | null;
  /** True als er wel een order gevonden is maar de afzender niet klopt. */
  identiteitMismatch: boolean;
  /** True als er meerdere orders op dit adres staan: noem expliciet welke. */
  meerdereOrders: boolean;
  /** De actie die de lus gaat uitvoeren, of "geen". */
  voorgesteldeActie: GelogdeActie;
  /** True als de refund daadwerkelijk gaat lopen (alle poorten open). */
  refundToegestaan: boolean;
  /** True bij PURCHASED of DELIVERED: operator-doorverwijzing, geen refund. */
  naInkoop: boolean;
  doel: ConceptDoel;
  /** Ondertekening, uit config (standaard Nina). */
  afzenderNaam: string;
  /**
   * Mag de bot bij een ordergebonden vraag zonder gevonden bestelling zelf om
   * het ordernummer of het kenteken vragen? Standaard ja. De lus zet dit op
   * false als hij dat in deze thread al eens gedaan heeft, of als de klant een
   * VH-nummer noemde dat niet bestaat: dan heeft doorvragen geen zin en kijkt
   * een mens ernaar.
   */
  magOrderVragen?: boolean;
}

export interface Concept {
  onderwerp: string;
  /** Platte tekst. Dit is wat de klant leest. */
  tekst: string;
  /** Optionele HTML-versie. Ontbreekt hij, dan maakt de app hem uit tekst. */
  html?: string;
  taal: Locale;
  kostenUsd?: number;
  model?: string;
}

// ---------------------------------------------------------------------------
// Controle op het concept (spec sectie 8)
// ---------------------------------------------------------------------------

export type ControleCode =
  | "leeg"
  | "bedrag_niet_in_feiten"
  | "streepje"
  | "robotzin"
  | "verkeerde_taal"
  | "verboden_merknaam"
  | "verboden_gegeven"
  | "te_lang";

export interface ControleProbleem {
  code: ControleCode;
  /** Korte uitleg voor de logregel en de escalatiemail. */
  detail: string;
}

export interface ControleResultaat {
  ok: boolean;
  problemen: ControleProbleem[];
}

// ---------------------------------------------------------------------------
// Acties (POST /api/bot/actie)
// ---------------------------------------------------------------------------

export type UitvoerActie =
  | "annuleer_refund"
  | "resend_bevestiging"
  | "resend_bewijs"
  | "antwoord_sturen"
  | "escalatie_sturen";

/** Wat er in de MailBotLog komt te staan. "geen" = alleen gearchiveerd. */
export type GelogdeActie = UitvoerActie | "geen";

export type EscalatieReden =
  | "identiteit_mismatch"
  | "geen_order"
  | "laag_vertrouwen"
  | "intent_mens_nodig"
  | "intent_factuur"
  | "intent_betaling"
  | "intent_klacht_juridisch"
  | "kenteken_fout_na_inkoop"
  | "status_niet_toegestaan"
  | "controle_afgekeurd"
  | "actie_mislukt"
  | "actie_onbekend"
  | "cap_bereikt"
  | "verzending_uit"
  | "refund_uitgevoerd"
  | "verwerkingsfout";

/** Gemeenschappelijke velden van elke actie. botMailId maakt hem idempotent. */
interface ActieBasis {
  botMailId: string;
  orderToken?: string;
}

export interface AnnuleerRefundOpdracht extends ActieBasis {
  actie: "annuleer_refund";
  orderToken: string;
  /**
   * Puur ter controle meegestuurd. De app rekent het bedrag ZELF uit
   * (totCents min al terugbetaald) en negeert dit veld als het afwijkt.
   */
  verwachtBedragCents: number;
  /**
   * Het afzenderadres van de binnengekomen mail (kleine letters, getrimd). De
   * app eist dat dit exact gelijk is aan order.email (defense-in-depth op de
   * identiteitsregel uit spec sectie 4, ook al checkt de bot dat zelf al).
   */
  afzender: string;
}

export interface ResendOpdracht extends ActieBasis {
  actie: "resend_bevestiging" | "resend_bewijs";
  orderToken: string;
  /** Afzenderadres, zelfde identiteitscheck als bij annuleer_refund. */
  afzender: string;
}

export interface AntwoordOpdracht extends ActieBasis {
  actie: "antwoord_sturen";
  /** Ontvanger. Altijd het afzenderadres van de binnengekomen mail. */
  naar: string;
  onderwerp: string;
  tekst: string;
  html?: string;
  taal: Locale;
  /** Voor de threading: Message-ID van de mail waarop we antwoorden. */
  inReplyTo?: string;
  references?: string[];
}

export interface EscalatieOpdracht extends ActieBasis {
  actie: "escalatie_sturen";
  reden: EscalatieReden;
  /** Extra uitleg voor Sabur, in het Nederlands. */
  toelichting: string;
  /** True bij klacht_juridisch: spoedvlag in het onderwerp. */
  spoed: boolean;
  /** De originele mail, zodat Sabur hem niet hoeft op te zoeken. */
  origineel: {
    van: string;
    onderwerp: string;
    ontvangenAt: string;
    tekst: string;
  };
  /** Kant-en-klaar conceptantwoord dat Sabur kan kopieren. Kan ontbreken. */
  concept?: { onderwerp: string; tekst: string; taal: Locale };
  intent?: Intent;
  vertrouwen?: number;
}

export type ActieOpdracht =
  | AnnuleerRefundOpdracht
  | ResendOpdracht
  | AntwoordOpdracht
  | EscalatieOpdracht;

export interface ActieResultaat {
  ok: boolean;
  actie: UitvoerActie;
  /** False betekent: er is niets gebeurd (schakelaar uit, of geweigerd). */
  uitgevoerd: boolean;
  /**
   * True = de uitkomst staat vast (gelukt of definitief geweigerd).
   * False = onbekend (time-out of 5xx). Bij een geldactie NOOIT opnieuw
   * proberen als dit false is, dan escaleren.
   */
  definitief: boolean;
  /** True als de app deze botMailId al eerder verwerkt had (idempotent). */
  idempotentHergebruik?: boolean;
  refundCents?: number;
  nieuweFulfilmentStatus?: FulfilmentStatus;
  /** Vrije melding van de app, bijvoorbeeld het PayPal-refundnummer. */
  melding?: string;
  /** Foutcode, snake_case, bijvoorbeeld status_niet_toegestaan. */
  fout?: string;
}

// ---------------------------------------------------------------------------
// Logregel (POST /api/bot/log, model MailBotLog, spec 7.3)
// ---------------------------------------------------------------------------

export interface MailBotLogRegel {
  botMailId: string;
  ontvangenAt: string;
  van: string;
  onderwerp: string;
  orderToken?: string;
  intent?: Intent;
  vertrouwen?: number;
  taal?: Locale;
  actie: GelogdeActie;
  /** De verstuurde of voorgestelde tekst. */
  antwoordTekst?: string;
  /** ISO-tijd van verzenden. Ontbreekt als er niets uitging. */
  verstuurdAt?: string;
  escalatie: boolean;
  escalatieReden?: EscalatieReden;
  kostenUsd?: number;
  /** Vrije melding bij de logregel, bijvoorbeeld het PayPal-refundnummer. */
  melding?: string;
  fout?: string;
  /** Waar de mail heen is verplaatst: Bot/Afgehandeld, Bot/Escalatie, Bot/Fout. */
  bestemming?: string;
}

// ---------------------------------------------------------------------------
// De vier functies die de andere bouwers leveren
// ---------------------------------------------------------------------------

/** src/classify.ts, claude-haiku-4-5. Mag gooien: de lus vangt dat af. */
export type ClassificeerFn = (mail: InkomendeMail) => Promise<Classificatie>;

/** src/compose.ts, claude-sonnet-5. */
export type StelOpFn = (invoer: OpstelInvoer) => Promise<Concept>;

/** src/verify.ts. Puur lokaal, geen LLM. Mag synchroon of async zijn. */
export type ControleerConceptFn = (
  concept: Concept,
  invoer: OpstelInvoer
) => Promise<ControleResultaat> | ControleResultaat;

/** src/acties.ts. Praat via src/api.ts met de app. */
export type VoerActieUitFn = (opdracht: ActieOpdracht) => Promise<ActieResultaat>;
