import type { CardPrinting } from '@mtg/shared';
import { and, asc, desc, eq, ilike, inArray, isNotNull, not, sql } from 'drizzle-orm';
import { schema, type CardRow, type Db } from '../db/index.js';

export const toPrinting = (row: CardRow): CardPrinting => ({
  id: row.id,
  oracleId: row.oracleId,
  name: row.name,
  lang: row.lang,
  layout: row.layout,
  setCode: row.setCode,
  setName: row.setName,
  collectorNumber: row.collectorNumber,
  releasedAt: row.releasedAt,
  rarity: row.rarity,
  typeLine: row.typeLine,
  manaCost: row.manaCost,
  cmc: row.cmc,
  colors: row.colors,
  colorIdentity: row.colorIdentity,
  oracleText: row.oracleText,
  imageUris: row.imageUris,
  faces: row.faces,
  isToken: row.isToken,
  isDigital: row.isDigital,
  isPromo: row.isPromo,
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Name search: one representative printing per distinct card, prefix matches
 * ranked before substring matches. Representative = latest English, non-promo,
 * non-digital printing.
 */
export async function searchCards(db: Db, query: string, limit: number): Promise<CardPrinting[]> {
  const q = escapeLike(query.trim());
  if (!q) return [];
  const c = schema.cards;

  const best = db
    .selectDistinctOn([c.oracleId])
    .from(c)
    .where(and(isNotNull(c.oracleId), ilike(c.name, `%${q}%`), eq(c.lang, 'en'), not(c.isDigital)))
    .orderBy(c.oracleId, asc(c.isPromo), desc(c.releasedAt))
    .as('best');

  const rows = await db
    .select()
    .from(best)
    .orderBy(sql`case when ${best.name} ilike ${`${q}%`} then 0 else 1 end`, asc(best.name), asc(best.setCode))
    .limit(limit);
  return rows.map(toPrinting);
}

/** All printings of a card, newest first. */
export async function listPrintings(db: Db, oracleId: string): Promise<CardPrinting[]> {
  const c = schema.cards;
  const rows = await db
    .select()
    .from(c)
    .where(eq(c.oracleId, oracleId))
    .orderBy(desc(c.releasedAt), asc(c.setCode), asc(c.collectorNumber));
  return rows.map(toPrinting);
}

export async function getPrinting(db: Db, id: string): Promise<CardPrinting | null> {
  const [row] = await db.select().from(schema.cards).where(eq(schema.cards.id, id)).limit(1);
  return row ? toPrinting(row) : null;
}

export async function getPrintings(db: Db, ids: string[]): Promise<CardPrinting[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(schema.cards).where(inArray(schema.cards.id, [...new Set(ids)]));
  return rows.map(toPrinting);
}
