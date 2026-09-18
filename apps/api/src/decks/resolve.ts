import { parseDecklist, type DeckImportResponse, type DecklistEntry, type ResolvedCard } from '@mtg/shared';
import { and, inArray, not, or, sql } from 'drizzle-orm';
import { toPrinting } from '../cards/search.js';
import { schema, type CardRow, type Db } from '../db/index.js';

/** Lower-case, straight apostrophes, single spaces, `A / B` and `A//B` → `a // b`. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s*\/{1,2}\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim();
}

const frontFace = (name: string) => nameKey(name).split(' // ')[0] ?? '';

/** Ranks printings for "no printing specified": English, paper, non-promo, newest. */
function rank(a: CardRow, b: CardRow): number {
  return (
    Number(a.lang !== 'en') - Number(b.lang !== 'en') ||
    Number(a.isDigital) - Number(b.isDigital) ||
    Number(a.isPromo) - Number(b.isPromo) ||
    b.releasedAt.localeCompare(a.releasedAt) ||
    a.setCode.localeCompare(b.setCode) ||
    a.collectorNumber.localeCompare(b.collectorNumber)
  );
}

/** Resolves a decklist text to printings. */
export async function resolveDecklist(db: Db, text: string): Promise<DeckImportResponse> {
  const parsed = parseDecklist(text);
  const entries = [...parsed.main, ...parsed.sideboard, ...parsed.commander];
  const keys = [...new Set(entries.map((e) => nameKey(e.name)))];

  const byKey = new Map<string, CardRow[]>();
  if (keys.length > 0) {
    const c = schema.cards;
    const rows = await db
      .select()
      .from(c)
      .where(
        and(
          or(inArray(sql`lower(${c.name})`, keys), inArray(sql`lower(split_part(${c.name}, ' // ', 1))`, keys)),
          not(c.isToken),
          not(inArray(c.layout, ['emblem', 'art_series'])),
        ),
      );
    for (const row of rows) {
      for (const k of new Set([nameKey(row.name), frontFace(row.name)])) {
        const list = byKey.get(k);
        if (list) list.push(row);
        else byKey.set(k, [row]);
      }
    }
    for (const list of byKey.values()) list.sort(rank);
  }

  const response: DeckImportResponse = {
    resolved: { main: [], sideboard: [], commander: [] },
    unknown: [],
    warnings: [],
    errors: parsed.errors,
  };

  const resolveEntry = (entry: DecklistEntry): ResolvedCard | null => {
    const candidates = byKey.get(nameKey(entry.name));
    if (!candidates || candidates.length === 0) return null;

    let chosen: CardRow | undefined;
    if (entry.set) {
      const inSet = candidates.filter((c) => c.setCode === entry.set);
      const exact = entry.collectorNumber
        ? inSet.find((c) => c.collectorNumber.toLowerCase() === entry.collectorNumber?.toLowerCase())
        : undefined;
      chosen = exact ?? inSet[0];
      if (!chosen || (entry.collectorNumber && !exact)) {
        const fallback = chosen ?? candidates[0]!;
        const wanted = `(${entry.set.toUpperCase()})${entry.collectorNumber ? ` ${entry.collectorNumber}` : ''}`;
        response.warnings.push({
          line: entry.line,
          message: `${entry.name}: printing ${wanted} not found, using (${fallback.setCode.toUpperCase()}) ${fallback.collectorNumber}`,
        });
        chosen = fallback;
      }
    } else {
      chosen = candidates[0]!;
    }

    const requested: ResolvedCard['requested'] = { name: entry.name };
    if (entry.set) requested.set = entry.set;
    if (entry.collectorNumber) requested.collectorNumber = entry.collectorNumber;
    return { line: entry.line, quantity: entry.quantity, requested, printing: toPrinting(chosen) };
  };

  for (const section of ['main', 'sideboard', 'commander'] as const) {
    for (const entry of parsed[section]) {
      const resolved = resolveEntry(entry);
      if (resolved) response.resolved[section].push(resolved);
      else {
        const unknown: DeckImportResponse['unknown'][number] = { line: entry.line, quantity: entry.quantity, name: entry.name };
        if (entry.set) unknown.set = entry.set;
        if (entry.collectorNumber) unknown.collectorNumber = entry.collectorNumber;
        response.unknown.push(unknown);
      }
    }
  }
  return response;
}
