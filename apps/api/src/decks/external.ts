import type { DeckUrlImportResponse } from '@mtg/shared';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { HttpError } from '../errors.js';
import { resolveDecklist } from './resolve.js';

/** Fetches a deck site's JSON; injectable for tests. */
export type DeckSiteFetch = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

export const fetchDeckSite: DeckSiteFetch = (url) =>
  fetch(url, { headers: { 'user-agent': 'mtg-table/0.1 (https://mtg.codes.hr)', accept: 'application/json' } });

export interface DeckRef {
  source: 'moxfield' | 'archidekt';
  id: string;
  api: string;
}

/** Recognises public deck URLs of the supported sites. */
export function parseDeckUrl(input: string): DeckRef | null {
  const s = input.trim();
  const mox = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i.exec(s);
  if (mox?.[1]) return { source: 'moxfield', id: mox[1], api: `https://api2.moxfield.com/v2/decks/all/${encodeURIComponent(mox[1])}` };
  const arch = /archidekt\.com\/(?:api\/)?decks\/(\d+)/i.exec(s);
  if (arch?.[1]) return { source: 'archidekt', id: arch[1], api: `https://archidekt.com/api/decks/${arch[1]}/` };
  return null;
}

interface Line {
  section: 'main' | 'sideboard' | 'commander';
  quantity: number;
  name: string;
  set?: string | undefined;
  collectorNumber?: string | undefined;
}

// Moxfield v2 (`mainboard: { [name]: { quantity, card } }`) and v3 (`boards.mainboard.cards`) shapes, read loosely.
const moxCard = z.looseObject({ quantity: z.number().int().optional(), card: z.looseObject({ name: z.string(), set: z.string().optional(), cn: z.string().optional() }).optional() });
const moxBoard = z.record(z.string(), z.unknown());
const moxSchema = z.looseObject({
  name: z.string().optional(),
  mainboard: moxBoard.optional(),
  sideboard: moxBoard.optional(),
  commanders: moxBoard.optional(),
  companions: moxBoard.optional(),
  boards: z.looseObject({
    mainboard: z.looseObject({ cards: moxBoard.optional() }).optional(),
    sideboard: z.looseObject({ cards: moxBoard.optional() }).optional(),
    commanders: z.looseObject({ cards: moxBoard.optional() }).optional(),
  }).optional(),
});

function moxLines(data: z.infer<typeof moxSchema>): Line[] {
  const out: Line[] = [];
  const read = (board: Record<string, unknown> | undefined, section: Line['section']) => {
    for (const [key, raw] of Object.entries(board ?? {})) {
      const c = moxCard.safeParse(raw);
      if (!c.success) continue;
      out.push({ section, quantity: c.data.quantity ?? 1, name: c.data.card?.name ?? key, set: c.data.card?.set, collectorNumber: c.data.card?.cn });
    }
  };
  read(data.boards?.mainboard?.cards ?? data.mainboard, 'main');
  read(data.boards?.sideboard?.cards ?? data.sideboard, 'sideboard');
  read(data.boards?.commanders?.cards ?? data.commanders, 'commander');
  read(data.companions, 'sideboard');
  return out;
}

const archSchema = z.looseObject({
  name: z.string().optional(),
  cards: z.array(z.looseObject({
    quantity: z.number().int().optional(),
    categories: z.array(z.string()).optional(),
    card: z.looseObject({
      oracleCard: z.looseObject({ name: z.string() }).optional(),
      edition: z.looseObject({ editioncode: z.string().optional() }).optional(),
      collectorNumber: z.union([z.string(), z.number()]).optional(),
    }),
  })),
});

function archLines(data: z.infer<typeof archSchema>): Line[] {
  const out: Line[] = [];
  for (const c of data.cards) {
    const name = c.card.oracleCard?.name;
    if (!name) continue;
    const cats = (c.categories ?? []).map((x) => x.toLowerCase());
    if (cats.includes('maybeboard')) continue;
    const section: Line['section'] = cats.includes('commander') ? 'commander' : cats.includes('sideboard') ? 'sideboard' : 'main';
    out.push({ section, quantity: c.quantity ?? 1, name, set: c.card.edition?.editioncode, collectorNumber: c.card.collectorNumber === undefined ? undefined : String(c.card.collectorNumber) });
  }
  return out;
}

/** The lines as a decklist our parser reads: main first, then `Sideboard` and `Commander` sections. */
export function linesToDecklist(lines: Line[]): string {
  const fmt = (l: Line) => `${l.quantity} ${l.name}${l.set ? ` (${l.set.toUpperCase()})${l.collectorNumber ? ` ${l.collectorNumber}` : ''}` : ''}`;
  const parts: string[] = [];
  const main = lines.filter((l) => l.section === 'main');
  const side = lines.filter((l) => l.section === 'sideboard');
  const cmd = lines.filter((l) => l.section === 'commander');
  if (main.length) parts.push(main.map(fmt).join('\n'));
  if (side.length) parts.push(`Sideboard\n${side.map(fmt).join('\n')}`);
  if (cmd.length) parts.push(`Commander\n${cmd.map(fmt).join('\n')}`);
  return parts.join('\n\n') + '\n';
}

export async function importDeckFromUrl(db: Db, url: string, fetchSite: DeckSiteFetch): Promise<DeckUrlImportResponse> {
  const ref = parseDeckUrl(url);
  if (!ref) throw new HttpError(400, 'bad_request', 'Enter a public Moxfield or Archidekt deck URL');
  let res: Awaited<ReturnType<DeckSiteFetch>>;
  try {
    res = await fetchSite(ref.api);
  } catch {
    throw new HttpError(502, 'upstream', `Could not reach ${ref.source === 'moxfield' ? 'Moxfield' : 'Archidekt'}`);
  }
  const site = ref.source === 'moxfield' ? 'Moxfield' : 'Archidekt';
  if (res.status === 404) throw new HttpError(404, 'not_found', `Deck ${ref.id} was not found on ${site} (private decks cannot be imported)`);
  if (res.status === 403 || res.status === 401) throw new HttpError(502, 'upstream', `${site} refused the request; paste the decklist instead`);
  if (res.status !== 200) throw new HttpError(502, 'upstream', `${site} answered ${res.status}`);
  const body = await res.json().catch(() => null);
  let name: string | undefined;
  let lines: Line[];
  if (ref.source === 'moxfield') {
    const parsed = moxSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(502, 'upstream', 'Unexpected Moxfield deck format');
    name = parsed.data.name;
    lines = moxLines(parsed.data);
  } else {
    const parsed = archSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(502, 'upstream', 'Unexpected Archidekt deck format');
    name = parsed.data.name;
    lines = archLines(parsed.data);
  }
  if (lines.length === 0) throw new HttpError(502, 'upstream', `The ${site} deck is empty`);
  const text = linesToDecklist(lines);
  const resolved = await resolveDecklist(db, text);
  return { ...resolved, name: name?.trim() || `${site} deck ${ref.id}`, source: ref.source, url: url.trim(), text };
}
