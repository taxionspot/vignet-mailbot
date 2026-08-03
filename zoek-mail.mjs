// Zoekt een mail terug in de postbus van de bot en laat zien WAAROM de bot hem
// wel of niet zou behandelen: in welke map hij ligt, van wie hij komt, en welke
// headers de lus-beveiliging kunnen laten afslaan.
//
// Draaien: node zoek-mail.mjs afmelden
//          node zoek-mail.mjs            (laat gewoon de nieuwste 15 zien)
//
// Leest alleen, verplaatst en verstuurt niets.
import { ImapFlow } from "imapflow";
import { readFileSync } from "node:fs";

const MVP = "C:/Users/Sabur/sites/vignet-mvp";
function leesEnv(pad) {
  const uit = {};
  for (const r of readFileSync(pad, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = r.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) uit[m[1]] = m[2].trim().replace(/^"|"$/g, "").replace(/\r$/, "");
  }
  return uit;
}
const env = leesEnv(`${MVP}/.env.local`);
const zoek = (process.argv[2] ?? "").toLowerCase();

const client = new ImapFlow({
  host: process.env.ZOHO_IMAP_HOST ?? "imap.zoho.eu",
  port: 993,
  secure: true,
  auth: { user: env.ZOHO_IMAP_USER, pass: env.ZOHO_APP_PASSWORD },
  logger: false,
});

await client.connect();
console.log(`verbonden als ${env.ZOHO_IMAP_USER}`);

const mappen = (await client.list()).map((m) => m.path);
console.log(`mappen: ${mappen.join(", ")}`);

for (const map of mappen) {
  let lock;
  try {
    lock = await client.getMailboxLock(map);
  } catch {
    continue;
  }
  try {
    const totaal = client.mailbox.exists;
    if (!totaal) continue;
    const vanaf = Math.max(1, totaal - 40);
    for await (const bericht of client.fetch(`${vanaf}:*`, { envelope: true, headers: true, flags: true })) {
      const onderwerp = bericht.envelope?.subject ?? "";
      if (zoek && !onderwerp.toLowerCase().includes(zoek)) continue;
      const kop = bericht.headers ? bericht.headers.toString() : "";
      const kopregel = (naam) => {
        const m = kop.match(new RegExp(`^${naam}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im"));
        return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 120) : "";
      };
      const van = (bericht.envelope?.from ?? []).map((a) => `${a.name ?? ""} <${a.address}>`).join(", ");
      console.log("");
      console.log(`--- map ${map}, uid ${bericht.uid} ---`);
      console.log(`onderwerp : ${onderwerp}`);
      console.log(`van       : ${van}`);
      console.log(`aan       : ${(bericht.envelope?.to ?? []).map((a) => a.address).join(", ")}`);
      console.log(`datum     : ${bericht.envelope?.date?.toISOString?.() ?? "?"}`);
      console.log(`vlaggen   : ${[...(bericht.flags ?? [])].join(" ")}`);
      for (const naam of [
        "Auto-Submitted", "X-Autoreply", "X-Autorespond", "Precedence", "List-Id",
        "List-Unsubscribe", "Return-Path", "Reply-To", "In-Reply-To", "References",
        "Authentication-Results", "X-Spam-Flag", "Message-ID",
      ]) {
        const w = kopregel(naam);
        if (w) console.log(`${naam.padEnd(22)}: ${w}`);
      }
    }
  } finally {
    lock.release();
  }
}
await client.logout();
