import { count } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '../db/index.js';
import { fakeSource, rawCard } from '../test/cards.js';
import { testDb } from '../test/db.js';
import { CardIngestService } from './ingest.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as never;

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

const cardCount = async () => (await db.select({ n: count() }).from(schema.cards))[0]!.n;

describe('CardIngestService', () => {
  it('ingests, upserts on re-run, and skips when the bulk file is unchanged', async () => {
    const source = fakeSource([
      rawCard(),
      rawCard({ id: '44444444-4444-4444-8444-444444444444', name: 'Counterspell', collector_number: '55' }),
      rawCard({ layout: 'art_series' }), // skipped by the mapper
    ]);
    const service = new CardIngestService(db, source, silentLog);

    expect(await service.start()).toEqual({ started: true });
    await service.wait();
    expect(await cardCount()).toBe(2);

    const status = await service.status();
    expect(status.cardCount).toBe(2);
    expect(status.latest).toMatchObject({ status: 'success', processed: 2, bulkUpdatedAt: '2026-09-18T09:05:32Z' });

    // Same bulk updated_at → nothing to do.
    expect(await service.start()).toEqual({ started: false, reason: 'bulk data unchanged' });
    expect(source.calls).toBe(1);

    // Forced re-run with a changed card updates in place instead of duplicating.
    const updated = new CardIngestService(db, fakeSource([rawCard({ name: 'Lightning Bolt (fixed)' })]), silentLog);
    expect(await updated.start({ force: true })).toEqual({ started: true });
    await updated.wait();
    expect(await cardCount()).toBe(2);
    const names = (await db.select({ name: schema.cards.name }).from(schema.cards)).map((r) => r.name).sort();
    expect(names).toEqual(['Counterspell', 'Lightning Bolt (fixed)']);
  });

  it('records a failed ingest and keeps existing rows (unflushed batch is discarded)', async () => {
    const broken = {
      bulkInfo: async () => ({ updatedAt: 'later', downloadUri: 'fake://broken', compressedSize: 0 }),
      async *cards() {
        yield rawCard({ id: '55555555-5555-4555-8555-555555555555', name: 'Partial' });
        throw new Error('connection reset');
      },
    };
    const service = new CardIngestService(db, broken, silentLog);
    expect(await service.start()).toEqual({ started: true });
    await service.wait();
    const status = await service.status();
    expect(status.latest).toMatchObject({ status: 'failed', error: 'connection reset' });
    expect(await cardCount()).toBe(2);
  });

  it('refuses to start while one is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = {
      bulkInfo: async () => ({ updatedAt: 'slow', downloadUri: 'fake://slow', compressedSize: 0 }),
      async *cards() {
        await gate;
        yield rawCard({ id: '66666666-6666-4666-8666-666666666666', name: 'Slow' });
      },
    };
    const service = new CardIngestService(db, slow, silentLog);
    expect(await service.start()).toEqual({ started: true });
    expect(await service.start()).toEqual({ started: false, reason: 'already running' });
    release();
    await service.wait();
    expect((await service.status()).latest?.status).toBe('success');
  });
});
