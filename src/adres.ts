// Adresvergelijking, bewust in een eigen module ZONDER imports.
//
// Waarom apart: match.ts trekt de api- en configuratielaag binnen, en daardoor
// is niets uit dat bestand te testen zonder een volledige .env. Deze functie is
// pure rekenkunde en moet juist overal te draaien zijn, ook op een laptop
// zonder botsleutels.
//
// Aanleiding (04-08): jana.petereit@dvag.de mailde over een bestelling die op
// jana.perereit@dvag.de staat, een verschil van EEN letter. Dat is geen vreemde
// maar een verschrijving bij het bestellen, en die klant kan dus nooit vanaf het
// "juiste" adres mailen. Wij delen daarom nog steeds NIETS (de identiteitsregel
// blijft hard); de escalatie naar Sabur vermeldt het alleen, zodat hij niet
// denkt dat iemand in andermans bestelling meekijkt.

/** Levenshtein-afstand, met vroege afbreking zodra hij boven `max` komt. */
function afstand(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let vorige = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const huidig = [i];
    let besteRij = i;
    for (let j = 1; j <= b.length; j++) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      const waarde = Math.min(vorige[j] + 1, huidig[j - 1] + 1, vorige[j - 1] + kosten);
      huidig.push(waarde);
      if (waarde < besteRij) besteRij = waarde;
    }
    if (besteRij > max) return max + 1;
    vorige = huidig;
  }
  return vorige[b.length];
}

/**
 * Lijkt het afzenderadres zo sterk op het besteladres dat het om een typefout
 * gaat? Eist HETZELFDE domein en hoogstens twee tekens verschil in het lokale
 * deel, met een ondergrens op de lengte zodat korte adressen (jan@, bob@) niet
 * per ongeluk als elkaars typefout gelden.
 */
export function lijktOpTypefout(afzenderAdres: string, orderEmail: string): boolean {
  const van = String(afzenderAdres ?? "").trim().toLowerCase();
  const bestel = String(orderEmail ?? "").trim().toLowerCase();
  if (!van || !bestel || van === bestel) return false;
  const [vanLokaal, vanDomein] = van.split("@");
  const [bestelLokaal, bestelDomein] = bestel.split("@");
  if (!vanDomein || vanDomein !== bestelDomein) return false;
  if (!vanLokaal || !bestelLokaal) return false;
  if (Math.min(vanLokaal.length, bestelLokaal.length) < 5) return false;
  const max = vanLokaal.length >= 10 ? 2 : 1;
  return afstand(vanLokaal, bestelLokaal, max) <= max;
}
