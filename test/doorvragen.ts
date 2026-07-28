// Test voor de verbrede doorvraag bij een onbekende bestelling (besluit Sabur
// 28-07). De bot mag de klant meermaals om een ordernummer, kenteken of een
// ander e-mailadres vragen voordat hij naar Sabur escaleert. De teller telt per
// thread EN per afzenderadres, zodat een nieuwe thread van dezelfde klant de
// lus niet stiekem reset.
//
// Draaien: npx tsx test/doorvragen.ts
//
// De STATE_MAP wijst naar een verse temp-map, zodat de echte caps.json van de
// draaiende bot ongemoeid blijft. Die env moet gezet zijn VOOR config.ts wordt
// geevalueerd, dus de bot-modules worden dynamisch geimporteerd.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let geslaagd = 0;
let gefaald = 0;
function check(naam: string, ok: boolean, detail = ""): void {
  if (ok) {
    geslaagd++;
    console.log(`  ok   ${naam}`);
  } else {
    gefaald++;
    console.log(`  FOUT ${naam}${detail ? ` :: ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  process.env.STATE_MAP = mkdtempSync(join(tmpdir(), "vignet-doorvragen-"));

  // config.ts eist bij import de verplichte bot-envs. Deze test raakt geen IMAP
  // en geen model, dus onschuldige dummy-waarden volstaan. Met ??= blijven echte
  // waarden uit een .env of de omgeving ongemoeid.
  process.env.ZOHO_IMAP_HOST ??= "imap.test.invalid";
  process.env.ZOHO_IMAP_USER ??= "test@test.invalid";
  process.env.ZOHO_APP_PASSWORD ??= "test";
  process.env.APP_BASIS_URL ??= "https://test.invalid";
  process.env.BOT_SECRET ??= "test";
  process.env.ANTHROPIC_API_KEY ??= "test";
  process.env.ESCALATIE_EMAIL ??= "test@test.invalid";

  const { orderVraagAantal, registreerOrderVraag } = await import("../src/guards.js");
  const { config } = await import("../src/config.js");

  // Minimale InkomendeMail: de teller gebruikt alleen threadSleutel en vanAdres.
  const mailA = { threadSleutel: "thread-A", vanAdres: "klant@example.com" } as never;

  check(
    "standaard maximaal 2 doorvraag-beurten",
    config.caps.maxOrderVragen === 2,
    String(config.caps.maxOrderVragen),
  );
  check("verse klant: teller staat op 0", orderVraagAantal(mailA) === 0);

  registreerOrderVraag(mailA);
  check(
    "na de 1e vraag: teller 1 en nog onder de grens (mag nog vragen)",
    orderVraagAantal(mailA) === 1 && orderVraagAantal(mailA) < config.caps.maxOrderVragen,
    String(orderVraagAantal(mailA)),
  );

  registreerOrderVraag(mailA);
  check(
    "na de 2e vraag: teller 2 en grens bereikt (escaleert nu)",
    orderVraagAantal(mailA) === 2 && !(orderVraagAantal(mailA) < config.caps.maxOrderVragen),
    String(orderVraagAantal(mailA)),
  );

  // Nieuwe thread, zelfde afzender: erft de teller via het afzenderadres, dus
  // de klant kan de lus niet resetten door een verse mail te beginnen.
  const mailB = { threadSleutel: "thread-B-nieuw", vanAdres: "klant@example.com" } as never;
  check(
    "nieuwe thread van dezelfde afzender erft de teller (geen lus)",
    orderVraagAantal(mailB) === 2,
    String(orderVraagAantal(mailB)),
  );

  // Een andere afzender begint schoon.
  const mailC = { threadSleutel: "thread-C", vanAdres: "iemand.anders@example.com" } as never;
  check("een andere afzender begint op 0", orderVraagAantal(mailC) === 0);

  console.log(`\n==== ${geslaagd} geslaagd, ${gefaald} gefaald ====`);
  if (gefaald > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
