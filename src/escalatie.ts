// Bouwt de interne escalatie aan Sabur (spec sectie 5). Deze laag STELT de
// escalatie samen; versturen doet de app (sendBotEscalatie in lib/vignet/
// notify.ts), aangeroepen via voerActieUit("escalatie_sturen"). De bot heeft
// geen eigen mailcreds, dus alle uitgaande post loopt via de app.
//
// Wat er in de escalatie hoort (taakopdracht):
//   - de originele mail,
//   - de gevonden order met een adminlink,
//   - de intent en het vertrouwen,
//   - de reden van escaleren,
//   - een kant-en-klaar conceptantwoord dat Sabur kan kopieren.
//
// Het onderwerp (ordernummer vooraan, SPOED bij een juridische klacht) wordt
// app-zijde in sendBotEscalatie samengesteld uit de velden orderToken en spoed
// hieronder. Dat komt doordat de EscalatieOpdracht in types.ts een GESTRUCTUREERD
// transporttype is zonder onderwerp-veld: de app rendert de mail. Wij zetten hier
// de gegevens klaar die dat onderwerp bepalen.

import { config } from "./config.js";
import type {
  Classificatie,
  Concept,
  EscalatieOpdracht,
  EscalatieReden,
  InkomendeMail,
  Intent,
  OrderFeiten,
} from "./types.js";

// Leesbare NL-labels voor de eerste regel van de toelichting. De app heeft een
// eigen kopie voor het onderwerp; die kan de bot-repo niet importeren.
const REDEN_LABEL: Record<EscalatieReden, string> = {
  identiteit_mismatch: "De afzender is niet de besteller. Geen ordergegevens naar deze afzender gestuurd.",
  geen_order: "Geen order aan deze mail te koppelen.",
  laag_vertrouwen: "De classificatie was te onzeker om zelf te antwoorden.",
  intent_mens_nodig: "Deze mail vraagt om een mens.",
  intent_factuur: "Factuurvraag, blijft handwerk.",
  intent_betaling: "Betaalprobleem, niet automatisch af te handelen.",
  intent_klacht_juridisch: "Juridische klacht of dreiging. Met spoed oppakken.",
  kenteken_fout_na_inkoop: "Kentekenfout terwijl het vignet al is ingekocht.",
  status_niet_toegestaan: "De gevraagde actie mocht niet in deze orderstatus.",
  controle_afgekeurd: "Het opgestelde antwoord is door de controle afgekeurd.",
  actie_mislukt: "De actie is definitief mislukt.",
  actie_onbekend: "De actie had een onbekende uitkomst (time-out of serverfout). NIET automatisch opnieuw geprobeerd.",
  cap_bereikt: "Een daglimiet is bereikt; de bot handelt deze categorie niet meer automatisch af.",
  verzending_uit: "MAILBOT_SEND staat uit; deze mail moet handmatig verstuurd worden.",
  refund_uitgevoerd: "Order automatisch geannuleerd en terugbetaald. NIET inkopen.",
  verwerkingsfout: "Onverwachte fout tijdens het verwerken van deze mail.",
};

/** Alles wat nodig is om een escalatie samen te stellen. */
export interface EscalatieInvoer {
  mail: InkomendeMail;
  reden: EscalatieReden;
  /** De gevonden order, of null als er geen (betrouwbare) match is. */
  order: OrderFeiten | null;
  /** De classificatie, voor intent en vertrouwen. Kan ontbreken bij een vroege fout. */
  classificatie?: Classificatie | null;
  /** Kant-en-klaar concept om te kopieren. Ontbreekt als er niets opgesteld is. */
  concept?: Concept | null;
  /** Extra, vrije uitleg bovenop het standaardlabel (bijvoorbeeld een foutcode). */
  extraUitleg?: string;
}

// De regels van de ordersamenvatting die Sabur intern mag zien. Anders dan bij
// de klant mag hier alles wat helpt om de order terug te vinden; de interne mail
// gaat alleen naar Sabur. We tonen bewust geen prijssplitsing, alleen het totaal.
function ordersamenvatting(order: OrderFeiten, adminUrl: string): string[] {
  const status = `${order.fulfilmentStatus} (betaling ${order.betaalStatus})`;
  const kenteken = order.plateCountry
    ? `${order.plateWeergave} (${order.plateCountry})`
    : order.plateWeergave;
  return [
    `Order: ${order.orderToken}`,
    `Land: ${order.landNaam} (${order.portaalNaam})`,
    `Product: ${order.productNaam}`,
    `Kenteken: ${kenteken}`,
    order.vin ? `Chassisnummer: ${order.vin}` : "",
    `Startdatum: ${order.startDatum}`,
    `Status: ${status}`,
    `Betaald: ${order.bedragWeergave}${order.alTerugbetaaldCents > 0 ? ` (al terugbetaald: ${order.alTerugbetaaldCents} cent)` : ""}`,
    `Klant: ${order.email}`,
    `Statuslink: ${order.statusUrl}`,
    `Admin: ${adminUrl}`,
  ].filter(Boolean);
}

/**
 * Leidt een escalatiereden af uit de classificatie en de orderstatus, voor de
 * gevallen die de lus niet al expliciet kent. Handig zodat de lus niet overal
 * de reden hoeft te herhalen. De lus mag altijd een eigen reden meegeven.
 */
export function escalatieRedenVoor(
  intent: Intent | undefined,
  opts: { identiteitMismatch?: boolean; geenOrder?: boolean; naInkoop?: boolean; laagVertrouwen?: boolean } = {}
): EscalatieReden {
  if (opts.identiteitMismatch) return "identiteit_mismatch";
  if (opts.geenOrder) return "geen_order";
  if (opts.laagVertrouwen) return "laag_vertrouwen";
  switch (intent) {
    case "klacht_juridisch":
      return "intent_klacht_juridisch";
    case "factuur":
      return "intent_factuur";
    case "betaling_probleem":
      return "intent_betaling";
    case "kenteken_fout":
      return opts.naInkoop ? "kenteken_fout_na_inkoop" : "intent_mens_nodig";
    case "mens_nodig":
      return "intent_mens_nodig";
    default:
      return "intent_mens_nodig";
  }
}

/**
 * Stelt de EscalatieOpdracht samen die de lus via voerActieUit("escalatie_sturen")
 * verstuurt. Puur samenstellen: geen netwerk, geen neveneffecten, gooit niet.
 */
export function bouwEscalatie(invoer: EscalatieInvoer): EscalatieOpdracht {
  const { mail, reden, order, classificatie, concept } = invoer;

  // Spoed bij een juridische klacht: zowel op de expliciete reden als op de
  // intent, zodat een klacht die als andere reden binnenkomt toch spoed krijgt.
  const spoed =
    reden === "intent_klacht_juridisch" || classificatie?.intent === "klacht_juridisch";

  const adminUrl = order
    ? `${config.app.basisUrl}/admin/orders?q=${encodeURIComponent(order.orderToken)}`
    : `${config.app.basisUrl}/admin`;

  // Toelichting: eerst waarom, dan (indien bekend) de ordersamenvatting met de
  // adminlink. In het Nederlands, want intern voor Sabur.
  const regels: string[] = [];
  regels.push(REDEN_LABEL[reden] ?? "Escalatie.");
  const extra = (invoer.extraUitleg ?? "").trim();
  if (extra) regels.push(extra);
  regels.push("");
  if (order) {
    regels.push(...ordersamenvatting(order, adminUrl));
  } else {
    regels.push("Er is geen order aan deze mail gekoppeld. Beoordeel hem handmatig.");
  }
  const toelichting = regels.join("\n");

  const vanWeergave = mail.vanNaam ? `${mail.vanNaam} <${mail.vanAdres}>` : mail.vanAdres;
  // De schone tekst gaat naar Sabur; valt terug op de volledige tekst als het
  // strippen niets overhield (heel korte mail of alleen een citaat).
  const origineelTekst = (mail.tekstSchoon || mail.tekstVolledig || "").trim();

  const opdracht: EscalatieOpdracht = {
    actie: "escalatie_sturen",
    botMailId: mail.botMailId,
    reden,
    toelichting,
    spoed,
    origineel: {
      van: vanWeergave,
      onderwerp: mail.onderwerp,
      ontvangenAt: mail.ontvangenAt.toISOString(),
      tekst: origineelTekst,
    },
  };

  if (order) opdracht.orderToken = order.orderToken;
  if (classificatie?.intent) opdracht.intent = classificatie.intent;
  if (typeof classificatie?.vertrouwen === "number") opdracht.vertrouwen = classificatie.vertrouwen;
  if (concept) {
    opdracht.concept = { onderwerp: concept.onderwerp, tekst: concept.tekst, taal: concept.taal };
  }

  return opdracht;
}
