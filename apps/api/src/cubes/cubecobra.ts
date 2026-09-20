import type { CubeCobraImportResponse, ResolvedCard } from '@mtg/shared';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { toPrinting } from '../cards/search.js';
import { schema, type Db } from '../db/index.js';
import { resolveDecklist } from '../decks/resolve.js';
import { HttpError } from '../errors.js';

/** Fetches a cube's JSON export; injectable for tests. */
export type CubeCobraFetch = (id: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

export const fetchCubeCobra: CubeCobraFetch = (id) =>
  fetch(`https://cubecobra.com/cube/api/cubeJSON/${encodeURIComponent(id)}`, { headers: { 'user-agent': 'mtg-table/0.1 (https://mtg.codes.hr)', accept: 'application/json' } });

/** Accepts a bare id or any cubecobra.com URL that contains one. */
export function cubeCobraId(ref: string): string | null {
  const s = ref.trim();
  const m = /cubecobra\.com\/cube\/(?:[a-z]+\/)?([A-Za-z0-9_-]+)/i.exec(s);
  if (m?.[1]) return m[1];
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

const exportSchema = z.looseObject({
  name: z.string().optional(),
  cards: z.union([
    z.array(z.unknown()),
    z.looseObject({ mainboard: z.array(z.unknown()).optional() }),
  ]),
});
const cardSchema = z.looseObject({
  cardID: z.string().optional(),
  board: z.string().optional(),
  details: z.looseObject({ name: z.string().optional(), set: z.string().optional(), collector_number: z.string().optional() }).optional(),
});

export async function importCubeCobra(db: Db, ref: string, fetchCube: CubeCobraFetch): Promise<CubeCobraImportResponse> {
  const id = cubeCobraId(ref);
  if (!id) throw new HttpError(400, 'bad_request', 'Enter a Cube Cobra cube URL or id');
  let res: Awaited<ReturnType<CubeCobraFetch>>;
  try {
    res = await fetchCube(id);
  } catch {
    throw new HttpError(502, 'upstream', 'Could not reach Cube Cobra');
  }
  if (res.status === 404) throw new HttpError(404, 'not_found', `Cube "${id}" was not found on Cube Cobra`);
  if (res.status !== 200) throw new HttpError(502, 'upstream', `Cube Cobra answered ${res.status}`);
  const parsed = exportSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new HttpError(502, 'upstream', 'Unexpected Cube Cobra export format');

  const raw = Array.isArray(parsed.data.cards) ? parsed.data.cards : (parsed.data.cards.mainboard ?? []);
  const entries = raw.map((c) => cardSchema.safeParse(c)).filter((r) => r.success).map((r) => r.data).filter((c) => !c.board || c.board === 'mainboard');

  // Exact printings first: Cube Cobra's cardID is the Scryfall id.
  const ids = [...new Set(entries.map((c) => c.cardID).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];
  const rows = ids.length ? await db.select().from(schema.cards).where(inArray(schema.cards.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, toPrinting(r)]));

  const resolved: ResolvedCard[] = [];
  const missing: { line: number; name: string; set?: string; collectorNumber?: string }[] = [];
  entries.forEach((c, i) => {
    const line = i + 1;
    const printing = c.cardID ? byId.get(c.cardID) : undefined;
    const name = c.details?.name;
    if (printing) resolved.push({ line, quantity: 1, requested: { name: printing.name }, printing });
    else if (name) {
      const m: { line: number; name: string; set?: string; collectorNumber?: string } = { line, name };
      if (c.details?.set) m.set = c.details.set;
      if (c.details?.collector_number) m.collectorNumber = c.details.collector_number;
      missing.push(m);
    }
  });

  // Anything our card table does not have under that id: resolve by name (and printing hint).
  let fallback: CubeCobraImportResponse['resolved']['main'] = [];
  let unknown: CubeCobraImportResponse['unknown'] = [];
  let warnings: CubeCobraImportResponse['warnings'] = [];
  if (missing.length > 0) {
    const text = missing.map((m) => `1 ${m.name}${m.set ? ` (${m.set.toUpperCase()})${m.collectorNumber ? ` ${m.collectorNumber}` : ''}` : ''}`).join('\n');
    const r = await resolveDecklist(db, text);
    const lineOf = (i: number) => missing[i - 1]?.line ?? i;
    fallback = r.resolved.main.map((x) => ({ ...x, line: lineOf(x.line) }));
    unknown = r.unknown.map((u) => ({ ...u, line: lineOf(u.line) }));
    warnings = r.warnings.map((w) => ({ ...w, line: lineOf(w.line) }));
  }

  return {
    name: parsed.data.name?.trim() || id,
    cubeCobraId: id,
    exactMatches: resolved.length,
    resolved: { main: [...resolved, ...fallback].sort((a, b) => a.line - b.line), sideboard: [], commander: [] },
    unknown,
    warnings,
    errors: [],
  };
}
