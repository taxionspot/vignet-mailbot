// Simpele, kleurloze logger met tijdstempel. Bewust geen dependency: pm2 vangt
// stdout en stderr al af, en een extra logpakket is hier overbodig.
//
// Niveaus: debug alleen als LOG_DEBUG=1. info, warn en fout altijd. Warn en
// fout gaan naar stderr zodat pm2 ze in het error-log zet.

function stempel(): string {
  return new Date().toISOString();
}

// Van objecten en Errors een korte, leesbare regel maken zonder de hele stack
// eronder te plakken als het niet hoeft.
function toon(extra: unknown): string {
  if (extra === undefined) return "";
  if (extra instanceof Error) {
    return ` ${extra.name}: ${extra.message}`;
  }
  if (typeof extra === "string") return ` ${extra}`;
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return " [onserializeerbaar object]";
  }
}

const debugAan = (process.env.LOG_DEBUG ?? "").trim() === "1";

export const log = {
  debug(bericht: string, extra?: unknown): void {
    if (!debugAan) return;
    process.stdout.write(`${stempel()} DEBUG ${bericht}${toon(extra)}\n`);
  },
  info(bericht: string, extra?: unknown): void {
    process.stdout.write(`${stempel()} INFO  ${bericht}${toon(extra)}\n`);
  },
  warn(bericht: string, extra?: unknown): void {
    process.stderr.write(`${stempel()} WARN  ${bericht}${toon(extra)}\n`);
  },
  fout(bericht: string, extra?: unknown): void {
    process.stderr.write(`${stempel()} FOUT  ${bericht}${toon(extra)}\n`);
  },
};
