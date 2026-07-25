// Noodroute voor escalatiemail, rechtstreeks vanaf de VM via Zoho SMTP.
//
// WAAROM DIT BESTAAT: normaal loopt alle uitgaande post via de app, die de
// ZeptoMail-API gebruikt. Op 25-07 bleek dat die API een harde daglimiet kan
// weigeren (TM_3601, "trial sending limit"), en dan verdween een escalatie
// STIL: de bot dacht dat hij Sabur had gewaarschuwd, maar er kwam niets aan.
// Een klant met een annuleerverzoek bleef zo liggen.
//
// Een escalatie is het vangnet van het hele systeem en mag daarom nooit van een
// enkele verzendweg afhangen. Faalt de app-route, dan stuurt de bot de melding
// zelf via SMTP. De VM kan dat wel (in tegenstelling tot de serverless app).
//
// Deze route is BEWUST alleen voor INTERNE post (naar Sabur). Klantmail blijft
// altijd via de app lopen, zodat er een bron van waarheid en een logregel is.

import nodemailer from "nodemailer";
import { config } from "./config.js";
import { log } from "./log.js";
import type { EscalatieOpdracht } from "./types.js";

// Zoho-SMTP, dezelfde inlog als IMAP (app-wachtwoord).
//
// POORT 587 MET STARTTLS, niet 465: Hetzner blokkeert uitgaand 25, 465 en 2525
// op deze VM (gemeten 25-07), alleen 587 komt eruit. Op 465 liep de noodroute
// in een verbindingstime-out van twee minuten.
const SMTP_HOST = "smtp.zoho.eu";
const SMTP_POORT = 587;

function escHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Is de noodroute bruikbaar? Zonder SMTP-inlog heeft proberen geen zin. */
export function noodmailBeschikbaar(): boolean {
  return Boolean(config.imap.user && config.imap.password && config.escalatieEmail);
}

/**
 * Stuurt de escalatie rechtstreeks via SMTP. Geeft true als het gelukt is.
 * Gooit nooit: mislukt ook dit, dan blijft alleen de logregel over.
 */
export async function stuurNoodEscalatie(opdracht: EscalatieOpdracht): Promise<boolean> {
  if (!noodmailBeschikbaar()) return false;

  const spoed = opdracht.spoed === true;
  const orderDeel = opdracht.orderToken ? `${opdracht.orderToken} ` : "";
  const onderwerp = `${spoed ? "SPOED " : ""}${orderDeel}mailbot: ${opdracht.reden}`;

  const org = opdracht.origineel;
  const regels = [
    `${spoed ? "SPOED " : ""}Mailbot-escalatie${opdracht.orderToken ? ` ${opdracht.orderToken}` : ""}`,
    "",
    `Reden: ${opdracht.reden}`,
    opdracht.intent ? `Intent: ${opdracht.intent}` : "",
    typeof opdracht.vertrouwen === "number" ? `Vertrouwen: ${opdracht.vertrouwen}` : "",
    "",
    opdracht.toelichting,
    "",
    "Originele mail",
    `Van: ${org?.van ?? ""}`,
    `Onderwerp: ${org?.onderwerp ?? ""}`,
    `Ontvangen: ${org?.ontvangenAt ?? ""}`,
    "",
    org?.tekst ?? "",
    "",
    opdracht.concept ? `Concept-antwoord:\n${opdracht.concept.tekst}` : "",
    "",
    "LET OP: deze melding is via de noodroute (SMTP vanaf de VM) verstuurd,",
    "omdat de gewone verzendweg via de app faalde. Controleer de mailquota.",
  ].filter((r) => r !== "");
  const tekst = regels.join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1B2A38;">
    <div style="background:#FBEBE8;border:1px solid #C23A2B;border-radius:8px;padding:10px 12px;margin:0 0 12px;">
      <b>Noodroute:</b> de gewone verzendweg (app) faalde, deze melding komt rechtstreeks van de bot.
    </div>
    <pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escHtml(tekst)}</pre>
  </div>`;

  try {
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_POORT,
      // 587 begint onversleuteld en schakelt met STARTTLS over; requireTLS
      // dwingt af dat er nooit in platte tekst verstuurd wordt.
      secure: false,
      requireTLS: true,
      auth: { user: config.imap.user, pass: config.imap.password },
      connectionTimeout: 20000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    const res = await transport.sendMail({
      from: `VignetteHub mailbot <${config.imap.user}>`,
      to: config.escalatieEmail,
      subject: onderwerp,
      text: tekst,
      html,
      // Antwoordadres = de klant, zodat Sabur meteen kan reageren.
      ...(org?.van ? { replyTo: org.van } : {}),
    });
    log.info(`Noodroute: escalatie via SMTP verstuurd (${res.messageId ?? "ok"})`);
    return true;
  } catch (err) {
    log.fout("Noodroute: escalatie via SMTP OOK mislukt", err);
    return false;
  }
}
