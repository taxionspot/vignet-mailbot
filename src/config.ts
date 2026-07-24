// Alle configuratie uit de omgeving, met harde validatie bij het opstarten.
// Ontbreekt een verplichte waarde, dan stopt het proces met een duidelijke
// melding in plaats van half te draaien (spec sectie 2 en 9).
//
// .env wordt eenmalig geladen met dotenv. In productie zet pm2 de variabelen
// ook rechtstreeks; dotenv overschrijft die niet (dat is het standaardgedrag).

import { config as dotenvConfig } from "dotenv";
import { LOCALES } from "./types.js";

dotenvConfig();

// ---------------------------------------------------------------------------
// Hulpfuncties voor het lezen en valideren
// ---------------------------------------------------------------------------

/** Verzamelt alle ontbrekende verplichte variabelen, zodat we ze in een keer melden. */
const ontbreekt: string[] = [];

function verplicht(naam: string): string {
  const ruw = (process.env[naam] ?? "").trim();
  if (!ruw) {
    ontbreekt.push(naam);
    return "";
  }
  return ruw;
}

function optioneel(naam: string, standaard: string): string {
  const ruw = (process.env[naam] ?? "").trim();
  return ruw || standaard;
}

// Een aan/uit-schakelaar. Standaard aan (spec sectie 9: alle drie standaard aan).
// Alleen de expliciete uit-waarden 0, false, nee, off zetten hem uit.
function schakelaar(naam: string, standaardAan = true): boolean {
  const ruw = (process.env[naam] ?? "").trim().toLowerCase();
  if (!ruw) return standaardAan;
  if (["0", "false", "nee", "no", "off", "uit"].includes(ruw)) return false;
  if (["1", "true", "ja", "yes", "on", "aan"].includes(ruw)) return true;
  // Onbekende waarde: val terug op de standaard maar meld het niet als fatale fout.
  return standaardAan;
}

function geheelGetal(naam: string, standaard: number, min: number, max: number): number {
  const ruw = (process.env[naam] ?? "").trim();
  if (!ruw) return standaard;
  const n = Number(ruw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    ongeldig.push(`${naam} moet een geheel getal zijn (kreeg "${ruw}")`);
    return standaard;
  }
  if (n < min || n > max) {
    ongeldig.push(`${naam} moet tussen ${min} en ${max} liggen (kreeg ${n})`);
    return standaard;
  }
  return n;
}

/** Verzamelt validatiefouten die geen ontbrekende maar een foute waarde zijn. */
const ongeldig: string[] = [];

// ---------------------------------------------------------------------------
// De configuratie zelf
// ---------------------------------------------------------------------------

// Verplichte waarden. Zonder deze kan de bot niet functioneren.
const ZOHO_IMAP_HOST = verplicht("ZOHO_IMAP_HOST");
const ZOHO_IMAP_USER = verplicht("ZOHO_IMAP_USER");
const ZOHO_APP_PASSWORD = verplicht("ZOHO_APP_PASSWORD");
const APP_BASIS_URL_RUW = verplicht("APP_BASIS_URL");
const BOT_SECRET = verplicht("BOT_SECRET");
const ANTHROPIC_API_KEY = verplicht("ANTHROPIC_API_KEY");
const ESCALATIE_EMAIL = verplicht("ESCALATIE_EMAIL");

// Basis-URL normaliseren: trailing slash eraf, zodat we overal veilig kunnen
// samenstellen als `${APP_BASIS_URL}/api/bot/order`.
const APP_BASIS_URL = APP_BASIS_URL_RUW.replace(/\/+$/, "");
if (APP_BASIS_URL_RUW && !/^https?:\/\//i.test(APP_BASIS_URL_RUW)) {
  ongeldig.push(`APP_BASIS_URL moet met http:// of https:// beginnen (kreeg "${APP_BASIS_URL_RUW}")`);
}

// Escalatie-adres grof controleren.
if (ESCALATIE_EMAIL && !ESCALATIE_EMAIL.includes("@")) {
  ongeldig.push(`ESCALATIE_EMAIL is geen geldig e-mailadres (kreeg "${ESCALATIE_EMAIL}")`);
}

// Optionele waarden met defaults.
const ZOHO_IMAP_PORT = geheelGetal("ZOHO_IMAP_PORT", 993, 1, 65535);
const ZOHO_IMAP_SECURE = schakelaar("ZOHO_IMAP_SECURE", true);

// De drie schakelaars, alle drie standaard aan (besluit Sabur 23-07).
const MAILBOT_ENABLED = schakelaar("MAILBOT_ENABLED", true);
const MAILBOT_SEND = schakelaar("MAILBOT_SEND", true);
const MAILBOT_REFUND = schakelaar("MAILBOT_REFUND", true);

// Vierde schakelaar (besluit Sabur 24-07): stuurt de bot een korte
// ontvangstbevestiging als hij zelf niet verder kan en naar Sabur escaleert?
// Zonder deze bevestiging blijft het voor de klant stil tot Sabur antwoordt.
const MAILBOT_ONTVANGSTBEVESTIGING = schakelaar("MAILBOT_ONTVANGSTBEVESTIGING", true);

// Mag de bot zelf om een ordernummer of kenteken vragen als hij de bestelling
// niet kan vinden? Staat dit uit, dan gaat zo'n mail meteen naar Sabur (het
// oude gedrag van voor 24-07).
const MAILBOT_ZELF_DOORVRAGEN = schakelaar("MAILBOT_ZELF_DOORVRAGEN", true);

// Eist de bot bewijs (DMARC- of DKIM-pass) dat het afzenderadres echt is,
// voordat hij mailt naar iemand die NIET aan een bestelling te koppelen is?
// Staat dit aan, dan kan niemand met een vervalst From-adres onze bot post
// laten sturen naar een onschuldige derde. Voor klanten met een gevonden
// bestelling en kloppende identiteit verandert er niets.
// Zet dit alleen uit als blijkt dat de mailserver geen Authentication-Results
// meestuurt; dan blokkeert de poort namelijk ook echte klanten.
const MAILBOT_EIS_AUTHENTICATIE = schakelaar("MAILBOT_EIS_AUTHENTICATIE", true);

// Legt de bot kopieen van onze eigen uitgaande mail (het BCC-archief van de
// app) in de map Verzonden, zodat Sabur in zijn normale Verzonden-vak ziet wat
// er de deur uit ging? Herkenning gebeurt op de X-VH-Uitgaand-header en op het
// Delivered-To-adres hieronder.
const MAILBOT_VERZONDEN_ARCHIEF = schakelaar("MAILBOT_VERZONDEN_ARCHIEF", true);
const ARCHIEF_ADRES = optioneel("ARCHIEF_ADRES", "sent-archief@vignettehub.com").toLowerCase();

const POLL_SECONDEN = geheelGetal("POLL_SECONDEN", 30, 5, 3600);
const AFZENDER_NAAM = optioneel("AFZENDER_NAAM", "Nina");

// Caps uit spec sectie 9.
const CAP_ANTWOORDEN_PER_THREAD = geheelGetal("CAP_ANTWOORDEN_PER_THREAD", 3, 1, 100);
const CAP_MAILS_PER_AFZENDER_24U = geheelGetal("CAP_MAILS_PER_AFZENDER_24U", 10, 1, 1000);
const CAP_ANTWOORDEN_PER_DAG = geheelGetal("CAP_ANTWOORDEN_PER_DAG", 100, 1, 100000);
const CAP_REFUNDS_PER_DAG = geheelGetal("CAP_REFUNDS_PER_DAG", 10, 1, 10000);
// In euro's ingesteld, intern in centen bewaard.
const CAP_REFUND_EUR_PER_DAG = geheelGetal("CAP_REFUND_EUR_PER_DAG", 500, 1, 1000000);

// Vertrouwensdrempels voor de classificatie. Sinds 24-07 gesplitst (besluit
// Sabur): het geldpad en het juridische pad blijven streng op 0,75, terwijl een
// informatieve vraag (status, uitleg, bewijs kwijt) al vanaf 0,45 zelfstandig
// beantwoord wordt. Daar valt niets te verliezen: die antwoorden komen
// uitsluitend uit de databasefeiten en de kennisbank, en verify.ts keurt elk
// bedrag af dat niet letterlijk in de feiten staat.
function komma(naam: string, standaard: number): number {
  const ruw = (process.env[naam] ?? "").trim();
  if (!ruw) return standaard;
  const n = Number(ruw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    ongeldig.push(`${naam} moet tussen 0 en 1 liggen (kreeg "${ruw}")`);
    return standaard;
  }
  return n;
}

const VERTROUWEN_DREMPEL = komma("VERTROUWEN_DREMPEL", 0.75);
const VERTROUWEN_DREMPEL_INFO = komma("VERTROUWEN_DREMPEL_INFO", 0.45);

if (VERTROUWEN_DREMPEL_INFO > VERTROUWEN_DREMPEL) {
  ongeldig.push(
    `VERTROUWEN_DREMPEL_INFO (${VERTROUWEN_DREMPEL_INFO}) mag niet hoger zijn dan VERTROUWEN_DREMPEL (${VERTROUWEN_DREMPEL}); de informatieve drempel hoort de soepele te zijn`
  );
}

// IMAP-mapnamen. Zoho gebruikt "/" als delimiter, maar imapflow zet dat zelf om.
const MAP_INBOX = optioneel("MAP_INBOX", "INBOX");
const MAP_AFGEHANDELD = optioneel("MAP_AFGEHANDELD", "Bot/Afgehandeld");
const MAP_ESCALATIE = optioneel("MAP_ESCALATIE", "Bot/Escalatie");
const MAP_FOUT = optioneel("MAP_FOUT", "Bot/Fout");

// Waar de dagtellers op schijf staan, zodat een herstart de caps niet reset.
// Standaard naast het bestand, in de map data/.
const STATE_MAP = optioneel("STATE_MAP", "data");

// HTTP-time-out naar de app in milliseconden. Refund mag lang duren (PayPal),
// dus die krijgt een eigen, ruimere time-out.
const HTTP_TIMEOUT_MS = geheelGetal("HTTP_TIMEOUT_MS", 15000, 1000, 120000);
const HTTP_TIMEOUT_REFUND_MS = geheelGetal("HTTP_TIMEOUT_REFUND_MS", 60000, 5000, 300000);

// Modelnamen. Vast in de spec, maar overschrijfbaar zonder codewijziging.
const MODEL_CLASSIFY = optioneel("MODEL_CLASSIFY", "claude-haiku-4-5");
const MODEL_COMPOSE = optioneel("MODEL_COMPOSE", "claude-sonnet-5");

// Onze eigen domeinen: nooit op antwoorden (spec sectie 9, lus-beveiliging).
const EIGEN_DOMEINEN = optioneel("EIGEN_DOMEINEN", "vignettehub.com,taxionspot.nl")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Afronden: bij fouten stoppen met een duidelijke melding
// ---------------------------------------------------------------------------

if (ontbreekt.length > 0 || ongeldig.length > 0) {
  const regels: string[] = [];
  regels.push("");
  regels.push("VignetteHub mailbot kan niet starten: de configuratie is onvolledig.");
  if (ontbreekt.length > 0) {
    regels.push("");
    regels.push("Ontbrekende verplichte omgevingsvariabelen:");
    for (const naam of ontbreekt) regels.push(`  - ${naam}`);
  }
  if (ongeldig.length > 0) {
    regels.push("");
    regels.push("Ongeldige waarden:");
    for (const m of ongeldig) regels.push(`  - ${m}`);
  }
  regels.push("");
  regels.push("Zet deze in .env of in de omgeving en start opnieuw. Zie .env.example.");
  regels.push("");
  // Rechtstreeks naar stderr, niet via de logger: de logger hoort bij een
  // draaiend proces en we stoppen juist voordat er iets draait.
  process.stderr.write(regels.join("\n") + "\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Geexporteerde, bevroren configuratie
// ---------------------------------------------------------------------------

export const config = {
  imap: {
    host: ZOHO_IMAP_HOST,
    port: ZOHO_IMAP_PORT,
    secure: ZOHO_IMAP_SECURE,
    user: ZOHO_IMAP_USER,
    password: ZOHO_APP_PASSWORD,
  },
  app: {
    basisUrl: APP_BASIS_URL,
    botSecret: BOT_SECRET,
    httpTimeoutMs: HTTP_TIMEOUT_MS,
    httpTimeoutRefundMs: HTTP_TIMEOUT_REFUND_MS,
  },
  anthropic: {
    apiKey: ANTHROPIC_API_KEY,
    modelClassify: MODEL_CLASSIFY,
    modelCompose: MODEL_COMPOSE,
  },
  escalatieEmail: ESCALATIE_EMAIL,
  afzenderNaam: AFZENDER_NAAM,
  // De drie noodremmen, plus twee gedragsschakelaars.
  schakelaars: {
    enabled: MAILBOT_ENABLED,
    send: MAILBOT_SEND,
    refund: MAILBOT_REFUND,
    ontvangstbevestiging: MAILBOT_ONTVANGSTBEVESTIGING,
    zelfDoorvragen: MAILBOT_ZELF_DOORVRAGEN,
    eisAuthenticatie: MAILBOT_EIS_AUTHENTICATIE,
    verzondenArchief: MAILBOT_VERZONDEN_ARCHIEF,
  },
  archiefAdres: ARCHIEF_ADRES,
  poll: {
    seconden: POLL_SECONDEN,
  },
  caps: {
    antwoordenPerThread: CAP_ANTWOORDEN_PER_THREAD,
    mailsPerAfzender24u: CAP_MAILS_PER_AFZENDER_24U,
    antwoordenPerDag: CAP_ANTWOORDEN_PER_DAG,
    refundsPerDag: CAP_REFUNDS_PER_DAG,
    refundCentenPerDag: CAP_REFUND_EUR_PER_DAG * 100,
  },
  vertrouwenDrempel: VERTROUWEN_DREMPEL,
  vertrouwenDrempelInfo: VERTROUWEN_DREMPEL_INFO,
  mappen: {
    inbox: MAP_INBOX,
    afgehandeld: MAP_AFGEHANDELD,
    escalatie: MAP_ESCALATIE,
    fout: MAP_FOUT,
  },
  stateMap: STATE_MAP,
  talen: LOCALES,
  eigenDomeinen: EIGEN_DOMEINEN,
} as const;

export type Config = typeof config;
