// Zet de OrderFeiten uit GET /api/bot/order om naar een compact, mensleesbaar
// blok voor de opsteller, plus de lijst met toegestane bedragen die de controle
// in verify.ts gebruikt.
//
// Ontwerpkeuze: de velden worden DEFENSIEF gelezen. De feitenset komt over HTTP
// binnen en het endpoint wordt door een andere bouwer gemaakt, dus we accepteren
// meerdere plausibele veldnamen en vallen netjes terug op leeg. Zo klapt de bot
// nooit om op een hernoemd veld, en een ontbrekend feit belandt gewoon niet in
// de prompt (waarna het model "dit weet ik niet" zegt en de mail escaleert).
//
// Wat hier bewust NIET in komt (interne velden, verkenner verken:feiten):
// payerNaam, payerAdres, payerEmail, officieelCents, serviceCents, proofNote,
// refunds, refundTotaalCents, captureId, paypalOrderId, gclid en het statusToken
// los. De prijssplitsing tonen we nooit, alleen het totaalbedrag.

import type { OrderFeiten } from "./types.js";

// ---------------------------------------------------------------------------
// Defensieve lezers

export type Vrij = Record<string, unknown>;

export function alsObject(waarde: unknown): Vrij | null {
  return waarde !== null && typeof waarde === "object" ? (waarde as Vrij) : null;
}

function viaPad(bron: unknown, pad: string): unknown {
  let huidig: unknown = bron;
  for (const deel of pad.split(".")) {
    const obj = alsObject(huidig);
    if (!obj) return undefined;
    huidig = obj[deel];
  }
  return huidig;
}

/** Eerste pad dat een niet-lege string oplevert, anders "". */
export function leesTekst(bron: unknown, ...paden: string[]): string {
  for (const pad of paden) {
    const waarde = viaPad(bron, pad);
    if (typeof waarde === "string" && waarde.trim() !== "") return waarde.trim();
    if (typeof waarde === "number" && Number.isFinite(waarde)) return String(waarde);
    if (waarde instanceof Date && !Number.isNaN(waarde.getTime())) return waarde.toISOString();
  }
  return "";
}

/** Eerste pad dat een eindig getal oplevert, anders null. */
export function leesGetal(bron: unknown, ...paden: string[]): number | null {
  for (const pad of paden) {
    const waarde = viaPad(bron, pad);
    if (typeof waarde === "number" && Number.isFinite(waarde)) return waarde;
    if (typeof waarde === "string" && waarde.trim() !== "") {
      const n = Number(waarde);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Geld

export const VALUTA_SYMBOOL: Record<string, string> = { EUR: "EUR", PLN: "PLN" };

/** 2455 wordt "EUR 24,95"-stijl: bedrag met komma, valuta ervoor. */
export function formatteerGeld(cents: number, valuta = "EUR"): string {
  const teken = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const heel = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  const code = VALUTA_SYMBOOL[valuta.toUpperCase()] ?? valuta.toUpperCase();
  return `${teken}${code} ${heel},${rest}`;
}

/**
 * Zet een geschreven bedrag om naar hele centen. Accepteert 24,55 / 24.55 /
 * 1.234,50 / 1,234.50 / 24. Geeft null als het geen bedrag is.
 */
export function centenUitTekst(ruw: string): number | null {
  const schoon = ruw.replace(/[\s ]/g, "");
  if (!/^\d[\d.,]*$/.test(schoon)) return null;
  const laatsteKomma = schoon.lastIndexOf(",");
  const laatstePunt = schoon.lastIndexOf(".");
  const scheider = laatsteKomma > laatstePunt ? "," : laatstePunt > laatsteKomma ? "." : "";
  let heel = schoon;
  let fractie = "";
  if (scheider) {
    const index = scheider === "," ? laatsteKomma : laatstePunt;
    const staart = schoon.slice(index + 1);
    // Precies 1 of 2 cijfers achter het laatste teken = decimalen.
    // Drie cijfers is een duizendtalscheiding (1.234), dan telt alles als hele euro's.
    if (staart.length === 1 || staart.length === 2) {
      heel = schoon.slice(0, index);
      fractie = staart.padEnd(2, "0");
    }
  }
  const heleCijfers = heel.replace(/[.,]/g, "");
  if (heleCijfers === "" || !/^\d+$/.test(heleCijfers)) return null;
  const centen = Number(heleCijfers) * 100 + Number(fractie || "0");
  return Number.isFinite(centen) ? centen : null;
}

// ---------------------------------------------------------------------------
// Status in gewone taal
//
// Contract uit app/status/[token]/page.tsx: QUEUED, SCHEDULED en NEEDS_ACTION
// zijn voor de klant allemaal "in de wachtrij". NEEDS_ACTION is een intern
// signaal en wordt nooit als probleem benoemd.

export const STATUS_WACHTRIJ = ["QUEUED", "SCHEDULED", "NEEDS_ACTION"];

export function statusInGewoneTaal(status: string, geplandOp: string): string {
  switch (status.toUpperCase()) {
    case "QUEUED":
      return "in de wachtrij, wij registreren het vignet bij het portaal";
    case "SCHEDULED":
      return geplandOp
        ? `ingepland, wij registreren het vignet op de ingangsdatum ${geplandOp}`
        : "ingepland, wij registreren het vignet op de ingangsdatum";
    case "NEEDS_ACTION":
      return "in de wachtrij, wij registreren het vignet bij het portaal";
    case "PURCHASED":
      return "geregistreerd bij het officiele portaal, de levering wordt afgerond";
    case "DELIVERED":
      return "geleverd, het vignet staat geregistreerd op het kenteken bij het officiele portaal";
    case "CANCELLED":
      return "geannuleerd";
    case "REFUNDED":
      return "geannuleerd en terugbetaald";
    default:
      return "onbekend, dit moet een mens bekijken";
  }
}

/** Is er nog niet ingekocht? Dan mag er geannuleerd worden (spec sectie 6). */
export function voorInkoop(status: string): boolean {
  const s = status.toUpperCase();
  return s === "QUEUED" || s === "SCHEDULED";
}

// ---------------------------------------------------------------------------
// Datum

/** ISO of Date naar 23-07-2026. Onleesbaar? Dan de ruwe waarde. */
export function formatteerDatum(ruw: string): string {
  if (!ruw) return "";
  const d = new Date(ruw);
  if (Number.isNaN(d.getTime())) return ruw;
  const dag = String(d.getUTCDate()).padStart(2, "0");
  const maand = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dag}-${maand}-${d.getUTCFullYear()}`;
}

function siteUrl(): string {
  const ruw = process.env.MAILBOT_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://vignettehub.com";
  return ruw.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------

export interface FeitenBlok {
  bekend: boolean;
  orderToken: string;
  land: string;
  landNaam: string;
  productNaam: string;
  productId: string;
  kenteken: string;
  startDatum: string;
  fulfilmentStatus: string;
  statusUitleg: string;
  betaalStatus: string;
  betaald: boolean;
  voorInkoop: boolean;
  valuta: string;
  bedragCents: number | null;
  bedragTekst: string;
  statusLink: string;
  email: string;
  taal: string;
  /** Alle bedragen die in het antwoord mogen staan, in hele centen. */
  bedragenCents: number[];
  /** Dezelfde bedragen leesbaar, voor in de prompt. */
  bedragenTekst: string[];
  /** Het compacte blok dat de opsteller te zien krijgt. */
  tekst: string;
}

const LAND_NAMEN: Record<string, string> = {
  at: "Oostenrijk",
  ch: "Zwitserland",
  cz: "Tsjechie",
  sk: "Slowakije",
  ro: "Roemenie",
  bg: "Bulgarije",
};

/**
 * Kern van deze module: OrderFeiten naar een blok voor de opsteller plus de
 * toegestane bedragen. Werkt ook als er geen order gevonden is (bekend=false):
 * dan bevat het blok alleen de mededeling dat er geen bestelling bekend is, en
 * is de bedragenlijst leeg, waardoor elk bedrag in een concept wordt afgekeurd.
 */
export function bouwFeitenBlok(feiten: OrderFeiten | null | undefined): FeitenBlok {
  const bron = alsObject(feiten) ?? {};
  const kern = alsObject(bron.order) ?? bron;

  const orderToken = leesTekst(kern, "orderToken", "token", "ordernummer", "order");
  const land = leesTekst(kern, "land", "landCode", "country").toLowerCase();
  const landNaam = leesTekst(kern, "landNaam", "landNaamNl") || LAND_NAMEN[land] || "";
  const productNaam = leesTekst(kern, "productNaam", "productNaamLang", "productLabel", "product");
  const productId = leesTekst(kern, "productId", "product.id");
  const kenteken = leesTekst(kern, "plateWeergave", "kenteken", "plaat", "plate");
  const startDatum = formatteerDatum(leesTekst(kern, "startDate", "startDatum", "start", "ingangsdatum"));
  const fulfilmentStatus = leesTekst(
    kern,
    "fulfilmentStatus",
    "fulfilment.status",
    "status",
    "statusCode",
  ).toUpperCase();
  const geplandOp = formatteerDatum(
    leesTekst(kern, "purchaseDueDate", "fulfilment.purchaseDueDate", "geplandOp"),
  );
  const betaalStatus = leesTekst(kern, "paymentStatus", "payment.status", "betaalStatus").toUpperCase();
  const email = leesTekst(kern, "email", "klantEmail", "orderEmail").toLowerCase();
  const taal = leesTekst(kern, "uiLocale", "taal", "locale").toLowerCase();

  const totCents = leesGetal(kern, "totCents", "totaalCents", "bedragCents", "totaalBedragCents");
  const chargeCents = leesGetal(kern, "chargeCents", "afgeschrevenCents");
  const valutaRuw = leesTekst(kern, "currency", "valuta").toUpperCase() || "EUR";

  const statusToken = leesTekst(kern, "statusToken");
  const statusLink =
    leesTekst(kern, "statusUrl", "statusLink", "statuslink") ||
    (statusToken ? `${siteUrl()}/status/${statusToken}` : "");

  // Valuta-val: bij een Pools kenteken is er in zloty afgerekend. Dan noemen we
  // het bedrag dat de klant echt betaald heeft, en rekenen we nooit zelf om.
  const anderValuta = valutaRuw !== "EUR" && chargeCents != null;
  const bedragCents = anderValuta ? chargeCents : totCents;
  const valuta = anderValuta ? valutaRuw : "EUR";
  const bedragTekst = bedragCents != null ? formatteerGeld(bedragCents, valuta) : "";

  // Toegestane bedragen: alleen wat echt in de database staat. Beide waarden
  // mogen erin want beide zijn een feit uit het orderdocument; de splitsing
  // officieel/servicekosten NOOIT.
  const bedragenCents: number[] = [];
  const bedragenTekst: string[] = [];
  const voegToe = (cents: number | null, munt: string) => {
    if (cents == null || !Number.isFinite(cents)) return;
    const afgerond = Math.round(cents);
    if (bedragenCents.includes(afgerond)) return;
    bedragenCents.push(afgerond);
    bedragenTekst.push(formatteerGeld(afgerond, munt));
  };
  voegToe(bedragCents, valuta);
  if (anderValuta) voegToe(totCents, "EUR");

  const bekend = Boolean(orderToken || kenteken || bedragCents != null);
  const betaald = betaalStatus === "COMPLETED";

  const regels: Array<[string, string]> = [];
  const zet = (label: string, waarde: string) => {
    if (waarde) regels.push([label, waarde]);
  };
  zet("Ordernummer", orderToken);
  zet("Land", landNaam || land.toUpperCase());
  zet("Product", productNaam || productId);
  zet("Kenteken", kenteken);
  zet("Ingangsdatum", startDatum);
  zet("Stand van zaken", statusInGewoneTaal(fulfilmentStatus, geplandOp));
  zet("Betaling", betaald ? "betaald" : betaalStatus ? "nog niet afgerond" : "");
  zet("Betaald bedrag", bedragTekst);
  zet("Statuslink", statusLink);

  const tekst = bekend
    ? [
        "FEITEN OVER DEZE BESTELLING (uit onze database, dit is de enige waarheid):",
        ...regels.map(([label, waarde]) => `- ${label}: ${waarde}`),
        bedragenTekst.length
          ? `- Bedragen die je mag noemen: ${bedragenTekst.join(" of ")}. Andere bedragen bestaan niet.`
          : "- Er is geen bedrag bekend. Noem dus geen enkel bedrag.",
      ].join("\n")
    : "FEITEN OVER DEZE BESTELLING: er is geen bestelling gevonden. Je hebt dus geen ordergegevens, geen bedrag en geen status.";

  return {
    bekend,
    orderToken,
    land,
    landNaam,
    productNaam,
    productId,
    kenteken,
    startDatum,
    fulfilmentStatus,
    statusUitleg: statusInGewoneTaal(fulfilmentStatus, geplandOp),
    betaalStatus,
    betaald,
    voorInkoop: voorInkoop(fulfilmentStatus),
    valuta,
    bedragCents,
    bedragTekst,
    statusLink,
    email,
    taal,
    bedragenCents,
    bedragenTekst,
    tekst,
  };
}

/** Kortere ingang voor de controlelaag. */
export function toegestaneBedragen(feiten: OrderFeiten | null | undefined): number[] {
  return bouwFeitenBlok(feiten).bedragenCents;
}
