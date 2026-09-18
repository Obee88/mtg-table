import type { CardPrinting, Deck, DeckContents, DeckResponse, DeckSummary } from '@mtg/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toPrinting } from '../cards/search.js';
import { schema, type DeckRow } from '../db/index.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';
import { resolveDecklist } from './resolve.js';

const MAX_CARDS = 1000;

const deckCard = z.object({ printingId: z.uuid(), quantity: z.number().int().min(1).max(999) });
const contentsSchema = z.object({ main: z.array(deckCard), sideboard: z.array(deckCard), commander: z.array(deckCard) });
const deckInput = z.object({ name: z.string().trim().min(1).max(80), contents: contentsSchema });
const importInput = z.object({ text: z.string().max(100_000) });
const idParam = z.object({ id: z.uuid() });

const count = (cards: { quantity: number }[]) => cards.reduce((n, c) => n + c.quantity, 0);

const toDeck = (row: DeckRow): Deck => ({
  id: row.id,
  name: row.name,
  contents: row.contents,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toSummary = (row: DeckRow): DeckSummary => ({
  id: row.id,
  name: row.name,
  mainCount: count(row.contents.main),
  sideboardCount: count(row.contents.sideboard),
  commanderCount: count(row.contents.commander),
  updatedAt: row.updatedAt.toISOString(),
});

export async function deckRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });

  /** Merges duplicate printings per section and checks every printing exists. */
  async function validateContents(input: DeckContents): Promise<{ contents: DeckContents; cards: CardPrinting[] }> {
    const contents: DeckContents = { main: [], sideboard: [], commander: [] };
    for (const section of ['main', 'sideboard', 'commander'] as const) {
      const merged = new Map<string, number>();
      for (const c of input[section]) merged.set(c.printingId, (merged.get(c.printingId) ?? 0) + c.quantity);
      contents[section] = [...merged].map(([printingId, quantity]) => ({ printingId, quantity }));
    }
    const total = count(contents.main) + count(contents.sideboard) + count(contents.commander);
    if (total > MAX_CARDS) throw badRequest(`A deck may hold at most ${MAX_CARDS} cards`);

    const ids = [...new Set([...contents.main, ...contents.sideboard, ...contents.commander].map((c) => c.printingId))];
    const rows = ids.length ? await db.select().from(schema.cards).where(inArray(schema.cards.id, ids)) : [];
    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length > 0) throw badRequest(`Unknown printing ids: ${missing.join(', ')}`);
    return { contents, cards: rows.map(toPrinting) };
  }

  async function ownedDeck(id: string, userId: string): Promise<DeckRow> {
    const [row] = await db.select().from(schema.decks).where(and(eq(schema.decks.id, id), eq(schema.decks.ownerId, userId)));
    if (!row) throw notFound('Deck not found');
    return row;
  }

  app.post('/decks/import', async (req) => {
    const { text } = parse(importInput, req.body);
    return resolveDecklist(db, text);
  });

  app.get('/decks', async (req): Promise<DeckSummary[]> => {
    const rows = await db.select().from(schema.decks).where(eq(schema.decks.ownerId, req.user!.id)).orderBy(desc(schema.decks.updatedAt));
    return rows.map(toSummary);
  });

  app.post('/decks', async (req, reply) => {
    const input = parse(deckInput, req.body);
    const { contents, cards } = await validateContents(input.contents);
    const [row] = await db.insert(schema.decks).values({ ownerId: req.user!.id, name: input.name, contents }).returning();
    const body: DeckResponse = { deck: toDeck(row!), cards };
    return reply.code(201).send(body);
  });

  app.get('/decks/:id', async (req): Promise<DeckResponse> => {
    const { id } = parse(idParam, req.params);
    const row = await ownedDeck(id, req.user!.id);
    const { cards } = await validateContents(row.contents);
    return { deck: toDeck(row), cards };
  });

  app.put('/decks/:id', async (req): Promise<DeckResponse> => {
    const { id } = parse(idParam, req.params);
    await ownedDeck(id, req.user!.id);
    const input = parse(deckInput, req.body);
    const { contents, cards } = await validateContents(input.contents);
    const [row] = await db
      .update(schema.decks)
      .set({ name: input.name, contents, updatedAt: new Date() })
      .where(eq(schema.decks.id, id))
      .returning();
    return { deck: toDeck(row!), cards };
  });

  app.delete('/decks/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await ownedDeck(id, req.user!.id);
    await db.delete(schema.decks).where(eq(schema.decks.id, id));
    return reply.code(204).send();
  });
}
