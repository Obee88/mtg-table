import type { CardIngestStatus } from '@mtg/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { schema, type Db, type NewCardRow } from '../db/index.js';
import { mapCard } from './mapping.js';
import type { CardSource } from './scryfall.js';

const BATCH_SIZE = 500;
const PROGRESS_EVERY = 10; // batches

const UPSERT_COLUMNS = [
  'oracleId', 'name', 'lang', 'layout', 'setCode', 'setName', 'setType', 'collectorNumber', 'releasedAt', 'rarity',
  'typeLine', 'manaCost', 'cmc', 'colors', 'colorIdentity', 'oracleText', 'imageUris', 'faces', 'isToken', 'isDigital',
  'isPromo', 'updatedAt',
] as const satisfies readonly (keyof NewCardRow)[];

/**
 * Pulls the Scryfall bulk file into the `cards` table. One ingest runs at a
 * time per process; progress and outcome are recorded in `card_ingests`.
 */
export class CardIngestService {
  private running: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly source: CardSource,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Starts an ingest unless one is already running. Resolves once it has been recorded as started. */
  async start(opts: { force?: boolean } = {}): Promise<{ started: boolean; reason?: string }> {
    if (this.running) return { started: false, reason: 'already running' };
    const info = await this.source.bulkInfo();
    if (!opts.force) {
      const last = await this.latestSuccess();
      if (last?.bulkUpdatedAt === info.updatedAt) return { started: false, reason: 'bulk data unchanged' };
    }
    this.running = this.run(info.downloadUri, info.updatedAt).finally(() => (this.running = null));
    return { started: true };
  }

  /** Awaits a running ingest (tests and shutdown). */
  async wait(): Promise<void> {
    await this.running;
  }

  async status(): Promise<CardIngestStatus> {
    const [latest] = await this.db.select().from(schema.cardIngests).orderBy(desc(schema.cardIngests.startedAt)).limit(1);
    const [count] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.cards);
    return {
      cardCount: count?.n ?? 0,
      latest: latest
        ? {
            id: latest.id,
            status: latest.status,
            bulkUpdatedAt: latest.bulkUpdatedAt,
            processed: latest.processed,
            startedAt: latest.startedAt.toISOString(),
            finishedAt: latest.finishedAt?.toISOString() ?? null,
            error: latest.error,
          }
        : null,
    };
  }

  private async latestSuccess() {
    const [row] = await this.db
      .select()
      .from(schema.cardIngests)
      .where(eq(schema.cardIngests.status, 'success'))
      .orderBy(desc(schema.cardIngests.startedAt))
      .limit(1);
    return row ?? null;
  }

  private async run(downloadUri: string, bulkUpdatedAt: string): Promise<void> {
    const [ingest] = await this.db.insert(schema.cardIngests).values({ status: 'running', bulkUpdatedAt }).returning();
    if (!ingest) throw new Error('could not record ingest');
    this.log.info({ ingestId: ingest.id, bulkUpdatedAt }, 'card ingest started');

    let processed = 0;
    let batches = 0;
    let batch: NewCardRow[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await this.upsert(batch);
      processed += batch.length;
      batch = [];
      if (++batches % PROGRESS_EVERY === 0) {
        await this.db.update(schema.cardIngests).set({ processed }).where(eq(schema.cardIngests.id, ingest.id));
      }
    };

    try {
      for await (const raw of this.source.cards(downloadUri)) {
        const row = mapCard(raw);
        if (!row) continue;
        batch.push(row);
        if (batch.length >= BATCH_SIZE) await flush();
      }
      await flush();
      await this.db
        .update(schema.cardIngests)
        .set({ status: 'success', processed, finishedAt: new Date() })
        .where(eq(schema.cardIngests.id, ingest.id));
      this.log.info({ ingestId: ingest.id, processed }, 'card ingest finished');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(schema.cardIngests)
        .set({ status: 'failed', processed, finishedAt: new Date(), error: message })
        .where(eq(schema.cardIngests.id, ingest.id));
      this.log.error({ err, ingestId: ingest.id, processed }, 'card ingest failed');
    }
  }

  private async upsert(rows: NewCardRow[]): Promise<void> {
    const set = Object.fromEntries(
      UPSERT_COLUMNS.map((col) => [col, sql.raw(`excluded."${schema.cards[col].name}"`)]),
    ) as Record<(typeof UPSERT_COLUMNS)[number], ReturnType<typeof sql.raw>>;
    await this.db.insert(schema.cards).values(rows).onConflictDoUpdate({ target: schema.cards.id, set });
  }
}
