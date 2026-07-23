// Rem en noodrem (spec sectie 9): de drie schakelaars, de vier caps en de
// volledige lus-beveiliging.
//
// KEUZE VOOR DE CAPS: op schijf, niet via een telling in de app. De spec biedt
// beide opties. Een klein JSON-bestand op de VM is gekozen omdat (1) de app in
// sectie 7.2 alleen /api/bot/order, /api/bot/actie en /api/bot/log krijgt en er
// geen tel-endpoint bestaat, (2) de caps horen bij de machine die ze afdwingt
// en moeten blijven staan als de app onbereikbaar is, en (3) een bestand
// overleeft een pm2-herstart binnen dezelfde dag. De bot draait als een enkele
// pm2-instantie en verwerkt mails sequentieel, dus er is geen gelijktijdige
// schrijver en synchrone bestands-IO is veilig.

import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./log.js";
import type { InkomendeMail } from "./types.js";

// ---------------------------------------------------------------------------
// De drie schakelaars
// ---------------------------------------------------------------------------

/** MAILBOT_ENABLED: mag de bot lezen en verwerken? */
export function magVerwerken(): boolean {
  return config.schakelaars.enabled;
}

/** MAILBOT_SEND: mag de bot daadwerkelijk versturen? */
export function magVersturen(): boolean {
  return config.schakelaars.send;
}

/** MAILBOT_REFUND: mag de bot daadwerkelijk terugbetalen? */
export function magRefunden(): boolean {
  return config.schakelaars.refund;
}

// ---------------------------------------------------------------------------
// Lus-beveiliging (overgenomen uit het bot-tegen-bot-incident van 11-06)
// ---------------------------------------------------------------------------

export interface LusBeveiligingUitkomst {
  /** True = niet antwoorden. */
  blokkeer: boolean;
  /** Korte reden voor de logregel. */
  reden: string | null;
  /** True als de mail een bounce is: wel loggen, verder niets. */
  bounce: boolean;
}

// Herkent machinepost aan de headers. Retourneert de reden, of null als het
// gewone post lijkt.
function machinepostReden(mail: InkomendeMail): string | null {
  const h = mail.headers;

  // Auto-Submitted: alles behalve "no" betekent dat een machine de mail stuurde.
  if (h.autoSubmitted && h.autoSubmitted.trim().toLowerCase() !== "no") {
    return `Auto-Submitted: ${h.autoSubmitted.trim()}`;
  }
  // Elke vorm van autoreply-header.
  if (h.autoreply) {
    return "autoreply-header aanwezig";
  }
  // Precedence: bulk, junk, list of auto_reply.
  const prec = (h.precedence ?? "").trim().toLowerCase();
  if (prec && /(bulk|junk|list|auto[_-]?reply)/.test(prec)) {
    return `Precedence: ${prec}`;
  }
  // Mailinglijst: List-Id of List-Unsubscribe. De spec noemt List-Id; de
  // List-Unsubscribe-header is hetzelfde signaal en nemen we defensief mee.
  if (h.listId) {
    return "List-Id aanwezig (mailinglijst)";
  }
  if (h.listUnsubscribe) {
    return "List-Unsubscribe aanwezig (mailinglijst)";
  }
  return null;
}

// De ontvanger (= de afzender van de binnenkomende mail) tegen de verboden
// lokale delen: no-reply en varianten, mailer-daemon, postmaster.
function verbodenOntvangerReden(adres: string): string | null {
  if (!adres) return "geen afzenderadres";
  const lokaal = (adres.split("@")[0] ?? "").toLowerCase();
  if (/(no-?reply|noreply|do-?not-?reply|donotreply|mailer-daemon|postmaster)/.test(lokaal)) {
    return `niet-beantwoordbaar adres (${adres})`;
  }
  // Ook als het in het volledige adres zit (sommige daemons zetten het in het domein).
  if (/(mailer-daemon|postmaster)/.test(adres.toLowerCase())) {
    return `niet-beantwoordbaar adres (${adres})`;
  }
  return null;
}

// Eigen domeinen: nooit op antwoorden, anders praat de bot tegen zichzelf of
// tegen de andere systemen op ons eigen domein.
function eigenDomeinReden(adres: string): string | null {
  const domein = (adres.split("@")[1] ?? "").toLowerCase();
  if (!domein) return null;
  for (const eigen of config.eigenDomeinen) {
    if (domein === eigen || domein.endsWith(`.${eigen}`)) {
      return `eigen domein (${domein})`;
    }
  }
  return null;
}

/**
 * De volledige lus-beveiliging. Geeft blokkeer=true zodra de mail niet
 * beantwoord mag worden, met een reden voor de log. Bounces krijgen bounce=true
 * zodat de aanroeper ze alleen logt en archiveert.
 */
export function lusBeveiliging(mail: InkomendeMail): LusBeveiligingUitkomst {
  if (mail.isBounce) {
    return { blokkeer: true, reden: "bounce of DSN", bounce: true };
  }
  const machine = machinepostReden(mail);
  if (machine) {
    return { blokkeer: true, reden: machine, bounce: false };
  }
  const verboden = verbodenOntvangerReden(mail.vanAdres);
  if (verboden) {
    return { blokkeer: true, reden: verboden, bounce: false };
  }
  const eigen = eigenDomeinReden(mail.vanAdres);
  if (eigen) {
    return { blokkeer: true, reden: eigen, bounce: false };
  }
  return { blokkeer: false, reden: null, bounce: false };
}

// ---------------------------------------------------------------------------
// Caps: staat op schijf
// ---------------------------------------------------------------------------

interface ThreadTeller {
  aantal: number;
  laatstAt: number;
}

interface CapState {
  /** Amsterdamse kalenderdag YYYY-MM-DD; wisselt hij, dan resetten dag-tellers. */
  dagAmsterdam: string;
  antwoordenVandaag: number;
  refundsVandaag: number;
  refundCentenVandaag: number;
  /** Per cap de dag waarop Sabur al gemaild is, zodat dat maar 1x per dag gebeurt. */
  capGemeld: Record<string, string>;
  /** Afzender -> tijdstempels (ms) van verstuurde antwoorden, 24u-venster. */
  perAfzender: Record<string, number[]>;
  /** Threadsleutel -> teller van botantwoorden in die thread. */
  perThread: Record<string, ThreadTeller>;
}

const VENSTER_24U_MS = 24 * 60 * 60 * 1000;
const THREAD_BEWAAR_MS = 30 * 24 * 60 * 60 * 1000; // oude threads na 30 dagen opruimen

// Amsterdamse kalenderdag als YYYY-MM-DD, zonder tijdzone-dependency.
function dagAmsterdam(d: Date = new Date()): string {
  // en-CA levert het formaat YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function statePad(): string {
  const map = path.isAbsolute(config.stateMap) ? config.stateMap : path.join(process.cwd(), config.stateMap);
  return path.join(map, "caps.json");
}

function legeState(): CapState {
  return {
    dagAmsterdam: dagAmsterdam(),
    antwoordenVandaag: 0,
    refundsVandaag: 0,
    refundCentenVandaag: 0,
    capGemeld: {},
    perAfzender: {},
    perThread: {},
  };
}

let state: CapState | null = null;

function laadState(): CapState {
  if (state) return state;
  const pad = statePad();
  try {
    if (fs.existsSync(pad)) {
      const ruw = fs.readFileSync(pad, "utf8");
      const geladen = JSON.parse(ruw) as Partial<CapState>;
      state = {
        ...legeState(),
        ...geladen,
        capGemeld: geladen.capGemeld ?? {},
        perAfzender: geladen.perAfzender ?? {},
        perThread: geladen.perThread ?? {},
      };
    } else {
      state = legeState();
    }
  } catch (err) {
    // Kapotte state mag de bot niet stilleggen: begin schoon en meld het.
    log.warn(`Cap-state onleesbaar, begin schoon`, err);
    state = legeState();
  }
  rolloverEnOpruimen(state);
  return state;
}

function bewaarState(): void {
  if (!state) return;
  const pad = statePad();
  try {
    fs.mkdirSync(path.dirname(pad), { recursive: true });
    // Eerst naar een tijdelijk bestand, dan hernoemen: zo blijft caps.json heel
    // als het proces midden in een schrijfactie omvalt.
    const tmp = `${pad}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, pad);
  } catch (err) {
    log.warn("Cap-state wegschrijven mislukt", err);
  }
}

// Dagwissel afhandelen en oude gegevens opruimen. Draait bij het laden en voor
// elke lees/schrijf, zodat een bot die over middernacht heen blijft draaien de
// dag-tellers netjes reset.
function rolloverEnOpruimen(s: CapState): void {
  const vandaag = dagAmsterdam();
  if (s.dagAmsterdam !== vandaag) {
    s.dagAmsterdam = vandaag;
    s.antwoordenVandaag = 0;
    s.refundsVandaag = 0;
    s.refundCentenVandaag = 0;
    s.capGemeld = {};
  }
  const nu = Date.now();
  // Afzender-venster van 24u opschonen.
  for (const adres of Object.keys(s.perAfzender)) {
    s.perAfzender[adres] = s.perAfzender[adres].filter((t) => nu - t < VENSTER_24U_MS);
    if (s.perAfzender[adres].length === 0) delete s.perAfzender[adres];
  }
  // Oude threads opruimen.
  for (const sleutel of Object.keys(s.perThread)) {
    if (nu - s.perThread[sleutel].laatstAt > THREAD_BEWAAR_MS) delete s.perThread[sleutel];
  }
}

// ---------------------------------------------------------------------------
// Cap-uitkomsten
// ---------------------------------------------------------------------------

export interface CapUitkomst {
  /** True = deze categorie is over de cap, niet uitvoeren. */
  geblokkeerd: boolean;
  /** Welke cap: antwoord_thread, antwoord_afzender, antwoord_dag, refund_dag, refund_bedrag. */
  cap?: string;
  /** True als Sabur voor deze cap vandaag nog niet gemaild is (dan wel melden). */
  meldSabur?: boolean;
  /** Uitleg voor de log en de melding. */
  detail?: string;
}

// Markeert dat Sabur voor deze cap vandaag gemaild is; retourneert of dit de
// eerste keer was.
function markeerGemeld(capNaam: string): boolean {
  const s = laadState();
  const vandaag = dagAmsterdam();
  if (s.capGemeld[capNaam] === vandaag) return false;
  s.capGemeld[capNaam] = vandaag;
  bewaarState();
  return true;
}

function blokkeer(cap: string, detail: string): CapUitkomst {
  const meldSabur = markeerGemeld(cap);
  return { geblokkeerd: true, cap, detail, meldSabur };
}

/**
 * Controleert of een antwoord verstuurd mag worden. Toetst alle drie de
 * antwoord-caps: per thread, per afzender per 24u, en per dag totaal. Geeft de
 * eerste cap terug die dichtzit.
 */
export function magAntwoorden(mail: InkomendeMail): CapUitkomst {
  const s = laadState();
  rolloverEnOpruimen(s);

  // Per thread.
  const threadTeller = s.perThread[mail.threadSleutel]?.aantal ?? 0;
  if (threadTeller >= config.caps.antwoordenPerThread) {
    return blokkeer(
      "antwoord_thread",
      `thread ${mail.threadSleutel} heeft al ${threadTeller} botantwoorden (max ${config.caps.antwoordenPerThread})`
    );
  }

  // Per afzender per 24u.
  const nu = Date.now();
  const afzenderTijden = (s.perAfzender[mail.vanAdres] ?? []).filter((t) => nu - t < VENSTER_24U_MS);
  if (afzenderTijden.length >= config.caps.mailsPerAfzender24u) {
    return blokkeer(
      "antwoord_afzender",
      `${mail.vanAdres} kreeg al ${afzenderTijden.length} antwoorden in 24u (max ${config.caps.mailsPerAfzender24u})`
    );
  }

  // Per dag totaal.
  if (s.antwoordenVandaag >= config.caps.antwoordenPerDag) {
    return blokkeer(
      "antwoord_dag",
      `dagcap bereikt: ${s.antwoordenVandaag} antwoorden vandaag (max ${config.caps.antwoordenPerDag})`
    );
  }

  return { geblokkeerd: false };
}

/**
 * Registreert dat er een antwoord naar deze mail is verstuurd. Werkt de drie
 * antwoord-tellers bij en bewaart de state. Roep dit pas aan NADAT het antwoord
 * echt de deur uit is.
 */
export function registreerAntwoord(mail: InkomendeMail): void {
  const s = laadState();
  rolloverEnOpruimen(s);

  const bestaand = s.perThread[mail.threadSleutel];
  s.perThread[mail.threadSleutel] = {
    aantal: (bestaand?.aantal ?? 0) + 1,
    laatstAt: Date.now(),
  };

  const lijst = s.perAfzender[mail.vanAdres] ?? [];
  lijst.push(Date.now());
  s.perAfzender[mail.vanAdres] = lijst;

  s.antwoordenVandaag += 1;

  bewaarState();
}

/**
 * Controleert of een refund uitgevoerd mag worden. Toetst zowel de dag-count
 * (max 10) als de dag-som (max 500 EUR), met bedragCents als het te
 * refunden bedrag. Geeft de eerste cap terug die dichtzit.
 */
export function magRefunderen(bedragCents: number): CapUitkomst {
  const s = laadState();
  rolloverEnOpruimen(s);

  if (s.refundsVandaag >= config.caps.refundsPerDag) {
    return blokkeer(
      "refund_dag",
      `refund-dagcap bereikt: ${s.refundsVandaag} refunds vandaag (max ${config.caps.refundsPerDag})`
    );
  }

  const somNa = s.refundCentenVandaag + Math.max(0, bedragCents);
  if (somNa > config.caps.refundCentenPerDag) {
    const eurNa = (somNa / 100).toFixed(2);
    const eurCap = (config.caps.refundCentenPerDag / 100).toFixed(2);
    return blokkeer(
      "refund_bedrag",
      `refund-bedragcap bereikt: ${eurNa} EUR zou vandaag terugbetaald zijn (max ${eurCap} EUR)`
    );
  }

  return { geblokkeerd: false };
}

/**
 * Registreert een uitgevoerde refund. Werkt de dag-count en de dag-som bij.
 * Roep dit pas aan NADAT de refund bij de app als gelukt terugkwam.
 */
export function registreerRefund(bedragCents: number): void {
  const s = laadState();
  rolloverEnOpruimen(s);
  s.refundsVandaag += 1;
  s.refundCentenVandaag += Math.max(0, bedragCents);
  bewaarState();
}
