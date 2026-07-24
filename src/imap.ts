// IMAP-laag op basis van imapflow (spec sectie 3). Verantwoordelijk voor:
//
//   - een verbinding met automatische herverbinding en exponentiele wachttijd,
//   - het ophalen van ongelezen mails in INBOX,
//   - het aanmaken van de mappen Bot/Afgehandeld, Bot/Escalatie en Bot/Fout,
//   - een mail markeren als gelezen en verplaatsen naar een van die mappen.
//
// Nooit wissen. Een mail die tijdens verwerken crasht, verplaatst de aanroeper
// naar Bot/Fout; deze module gooit alleen als de verbinding echt weg is.

import { ImapFlow } from "imapflow";
import { config } from "./config.js";
import { log } from "./log.js";

// Hoeveel mails we per poll-ronde maximaal in het geheugen trekken. Houdt de
// geheugenvoetafdruk klein bij een plotselinge stapel post.
const MAX_PER_RONDE = 50;

// Backoff-parameters voor de herverbinding.
const BACKOFF_BASIS_MS = 2000;
const BACKOFF_MAX_MS = 5 * 60 * 1000; // niet langer dan vijf minuten wachten

function slaap(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export interface RuweMail {
  /** IMAP-UID in INBOX, alleen geldig binnen deze verbinding. */
  uid: number;
  /** De volledige RFC-822 bron. */
  ruw: Buffer;
}

export class Postbus {
  private client: ImapFlow | null = null;
  private verbindtBezig = false;
  // Pad van de map Verzonden (special-use \Sent), eenmalig opgezocht.
  private verzondenPad: string | null = null;

  // Nieuwe imapflow-client opzetten. logger:false, want we loggen zelf; een
  // eigen error-listener voorkomt dat een socketfout het proces omlegt.
  private nieuweClient(): ImapFlow {
    const client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port,
      secure: config.imap.secure,
      auth: {
        user: config.imap.user,
        pass: config.imap.password,
      },
      logger: false,
    });
    // Zonder deze listener gooit imapflow een 'error'-event dat als
    // uncaughtException het proces zou beeindigen. We loggen en laten de
    // herverbinding het opknappen.
    client.on("error", (err) => {
      log.warn("IMAP-fout op de verbinding", err);
    });
    client.on("close", () => {
      log.debug("IMAP-verbinding gesloten");
    });
    return client;
  }

  // Eenmalige verbindpoging plus mappen verzekeren. Gooit bij mislukken.
  private async verbind(): Promise<void> {
    const client = this.nieuweClient();
    await client.connect();
    this.client = client;
    await this.verzekerMappen();
    log.info(`IMAP verbonden met ${config.imap.host} als ${config.imap.user}`);
  }

  /**
   * Zorgt dat er een bruikbare verbinding is. Blijft het proberen met
   * exponentiele backoff tot het lukt, zodat een tijdelijke storing de bot niet
   * omlegt. Roep dit aan bij het begin van elke poll-ronde en na een fout.
   */
  async zorgVerbonden(): Promise<void> {
    if (this.client && this.client.usable) return;
    if (this.verbindtBezig) {
      // Een andere aanroep is al bezig; wacht kort en controleer opnieuw.
      while (this.verbindtBezig) await slaap(200);
      if (this.client && this.client.usable) return;
    }
    this.verbindtBezig = true;
    try {
      let poging = 0;
      // Blijven proberen tot het lukt.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await this.verbind();
          return;
        } catch (err) {
          poging += 1;
          const basis = Math.min(BACKOFF_BASIS_MS * 2 ** (poging - 1), BACKOFF_MAX_MS);
          const jitter = Math.floor(Math.random() * 1000);
          const wacht = basis + jitter;
          log.warn(`IMAP-verbinding mislukt (poging ${poging}), opnieuw over ${Math.round(wacht / 1000)}s`, err);
          // Kapotte client opruimen voor de volgende poging.
          try {
            this.client?.close();
          } catch {
            // negeren
          }
          this.client = null;
          await slaap(wacht);
        }
      }
    } finally {
      this.verbindtBezig = false;
    }
  }

  // De drie Bot-mappen aanmaken als ze nog niet bestaan. mailboxCreate meldt
  // via created:false dat de map al bestond en gooit dan niet; toch vangen we
  // een eventuele ALREADYEXISTS-fout af voor servers die dat wel doen.
  private async verzekerMappen(): Promise<void> {
    if (!this.client) return;
    for (const map of [config.mappen.afgehandeld, config.mappen.escalatie, config.mappen.fout]) {
      try {
        const res = await this.client.mailboxCreate(map);
        if (res.created) log.info(`IMAP-map aangemaakt: ${map}`);
      } catch (err) {
        const bericht = err instanceof Error ? err.message : String(err);
        if (/exist/i.test(bericht)) {
          // Bestaat al, prima.
          continue;
        }
        log.warn(`Kon map ${map} niet aanmaken`, err);
      }
    }
  }

  /**
   * Haalt de ongelezen mails uit INBOX op, tot MAX_PER_RONDE stuks. Markeert
   * ze NIET als gelezen (imapflow fetcht met PEEK). De aanroeper markeert en
   * verplaatst pas na verwerking, via afhandelen().
   */
  async haalOngelezen(): Promise<RuweMail[]> {
    await this.zorgVerbonden();
    const client = this.client;
    if (!client) return [];

    const lock = await client.getMailboxLock(config.mappen.inbox);
    const uit: RuweMail[] = [];
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return [];
      // Oudste eerst, en niet meer dan MAX_PER_RONDE tegelijk.
      const teVerwerken = uids.slice(0, MAX_PER_RONDE);
      for await (const msg of client.fetch(teVerwerken, { uid: true, source: true }, { uid: true })) {
        if (msg.source) {
          uit.push({ uid: msg.uid, ruw: msg.source });
        }
      }
      if (uids.length > MAX_PER_RONDE) {
        log.info(`${uids.length} ongelezen mails; deze ronde ${MAX_PER_RONDE} verwerkt, rest volgende ronde`);
      }
      return uit;
    } finally {
      lock.release();
    }
  }

  /**
   * Markeert een mail als gelezen en verplaatst hem naar de opgegeven map.
   * Nooit wissen. De \Seen-vlag reist mee met de verplaatsing.
   */
  async afhandelen(uid: number, bestemming: string): Promise<void> {
    await this.zorgVerbonden();
    const client = this.client;
    if (!client) throw new Error("geen IMAP-verbinding voor afhandelen");

    const lock = await client.getMailboxLock(config.mappen.inbox);
    try {
      await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      await client.messageMove(uid, bestemming, { uid: true });
    } finally {
      lock.release();
    }
  }

  /**
   * Zoekt de echte map Verzonden op via de special-use-vlag \Sent, zodat een
   * kopie van eigen uitgaande post daar terechtkomt en Sabur hem in zijn
   * normale Verzonden-vak ziet. Terugval op "Sent" (de Zoho-standaard).
   */
  async vindVerzondenMap(): Promise<string> {
    if (this.verzondenPad) return this.verzondenPad;
    await this.zorgVerbonden();
    const client = this.client;
    if (!client) return "Sent";
    try {
      const mappen = await client.list();
      const sent = mappen.find((m) => (m.specialUse ?? "").toLowerCase() === "\\sent");
      this.verzondenPad = sent?.path ?? "Sent";
    } catch (err) {
      log.warn("Kon de map Verzonden niet opzoeken, terugval op Sent", err);
      this.verzondenPad = "Sent";
    }
    return this.verzondenPad;
  }

  /** Netjes afsluiten bij een noodstop. */
  async sluit(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.logout();
    } catch (err) {
      log.warn("IMAP-logout mislukt, verbinding wordt geforceerd gesloten", err);
      try {
        client.close();
      } catch {
        // negeren
      }
    }
  }
}
