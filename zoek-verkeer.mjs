// Alle mailverkeer met een adres, in alle mappen. Bedoeld om te zien wat wij naar
// iemand hebben gestuurd en wat hij ons stuurde, bijvoorbeeld na een afmelding.
// Draaien: node zoek-verkeer.mjs adres@voorbeeld.nl
// Leest alleen.
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
const adres = (process.argv[2] ?? "").toLowerCase();
if (!adres) { console.log("gebruik: node zoek-verkeer.mjs adres@voorbeeld.nl"); process.exit(1); }

const client = new ImapFlow({
  host: process.env.ZOHO_IMAP_HOST ?? "imap.zoho.eu",
  port: 993, secure: true,
  auth: { user: env.ZOHO_IMAP_USER, pass: env.ZOHO_APP_PASSWORD },
  logger: false,
});
await client.connect();

const mappen = (await client.list()).map((m) => m.path);
const gevonden = [];
for (const map of mappen) {
  let lock;
  try { lock = await client.getMailboxLock(map); } catch { continue; }
  try {
    let uids = [];
    try {
      // IMAP zoekt zelf; dat is veel sneller dan alles binnenhalen.
      const a = await client.search({ or: [{ from: adres }, { to: adres }, { cc: adres }] }, { uid: true });
      uids = a ?? [];
    } catch { uids = []; }
    if (!uids.length) continue;
    for await (const b of client.fetch(uids.slice(-25), { envelope: true, flags: true }, { uid: true })) {
      gevonden.push({
        map,
        datum: b.envelope?.date?.toISOString?.() ?? "?",
        van: (b.envelope?.from ?? []).map((x) => x.address).join(","),
        aan: (b.envelope?.to ?? []).map((x) => x.address).join(","),
        onderwerp: (b.envelope?.subject ?? "").slice(0, 80),
        gelezen: [...(b.flags ?? [])].includes("\\Seen"),
      });
    }
  } finally { lock.release(); }
}
gevonden.sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
console.log(`${gevonden.length} bericht(en) met ${adres}\n`);
for (const g of gevonden) {
  const richting = g.van.toLowerCase().includes(adres) ? "VAN KLANT" : "naar klant";
  console.log(`${g.datum.slice(0, 16).replace("T", " ")}  ${richting}  [${g.map}]  ${g.onderwerp}${g.gelezen ? "" : "  (ongelezen)"}`);
}
await client.logout();
