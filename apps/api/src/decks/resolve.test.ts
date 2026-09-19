import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CardIngestService } from '../cards/ingest.js';
import type { Db } from '../db/index.js';
import { fakeSource, rawCard } from '../test/cards.js';
import { testDb } from '../test/db.js';
import { nameKey, resolveDecklist } from './resolve.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as never;

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await testDb());
  const service = new CardIngestService(
    db,
    fakeSource([
      rawCard({ id: 'a1111111-1111-4111-8111-111111111111', set: 'lea', released_at: '1993-08-05' }),
      rawCard({ id: 'a2222222-1111-4111-8111-111111111111', set: 'm11', set_name: 'Magic 2011', released_at: '2010-07-16', collector_number: '149' }),
      rawCard({ id: 'a3333333-1111-4111-8111-111111111111', set: 'plst', released_at: '2024-01-01', promo: true, collector_number: '1' }),
      rawCard({ id: 'a4444444-1111-4111-8111-111111111111', set: 'ha1', released_at: '2025-01-01', digital: true, collector_number: '2' }),
      rawCard({ id: 'a5555555-1111-4111-8111-111111111111', set: 'lea', lang: 'de', name: 'Blitzschlag' }),
      rawCard({
        id: 'd1111111-1111-4111-8111-111111111111', oracle_id: '99999999-9999-4999-8999-999999999999',
        name: 'Delver of Secrets // Insectile Aberration', layout: 'transform', image_uris: undefined,
        card_faces: [{ name: 'Delver of Secrets', image_uris: { normal: 'f' } }, { name: 'Insectile Aberration' }],
      }),
      rawCard({ id: 'e1111111-1111-4111-8111-111111111111', oracle_id: '88888888-8888-4888-8888-888888888888', name: 'Fire // Ice', layout: 'split' }),
      rawCard({ id: 't1111111-1111-4111-8111-111111111111', oracle_id: '66666666-6666-4666-8666-666666666666', name: 'Lightning Bolt', layout: 'token', set_type: 'token', set: 'tlea' }),
    ]),
    silentLog,
  );
  await service.start();
  await service.wait();
});
afterAll(() => close());

describe('nameKey', () => {
  it('normalises case, apostrophes, spacing and face separators', () => {
    expect(nameKey('  Fire/Ice ')).toBe('fire // ice');
    expect(nameKey('Fire//Ice')).toBe('fire // ice');
    expect(nameKey('Atraxa, Praetors’ Voice')).toBe("atraxa, praetors' voice");
  });
});

describe('resolveDecklist', () => {
  it('picks the oldest English paper non-promo printing by default and never a token', async () => {
    const r = await resolveDecklist(db, '4 lightning bolt');
    expect(r.unknown).toEqual([]);
    expect(r.resolved.main).toHaveLength(1);
    expect(r.resolved.main[0]).toMatchObject({ quantity: 4, printing: { setCode: 'lea', collectorNumber: '161' } });
  });

  it('honours set and collector number hints, and warns on fallback', async () => {
    const r = await resolveDecklist(db, `1 Lightning Bolt (LEA) 161
1 Lightning Bolt (PLST)
1 Lightning Bolt (M11) 999
1 Lightning Bolt (ZZZ) 1`);
    expect(r.resolved.main.map((c) => c.printing.setCode)).toEqual(['lea', 'plst', 'm11', 'lea']);
    expect(r.warnings.map((w) => w.line)).toEqual([3, 4]);
    expect(r.warnings[0]?.message).toContain('(M11) 999 not found');
    expect(r.warnings[1]?.message).toContain('using (LEA) 161');
  });

  it('matches double-faced and split cards by front face or full name', async () => {
    const r = await resolveDecklist(db, `1 Delver of Secrets
1 Delver of Secrets // Insectile Aberration
1 Fire
1 Fire/Ice
1 Insectile Aberration`);
    expect(r.resolved.main.map((c) => c.printing.name)).toEqual([
      'Delver of Secrets // Insectile Aberration',
      'Delver of Secrets // Insectile Aberration',
      'Fire // Ice',
      'Fire // Ice',
    ]);
    expect(r.unknown.map((u) => u.name)).toEqual(['Insectile Aberration']);
  });

  it('keeps sections, reports unknown names with lines, and passes parser errors through', async () => {
    const r = await resolveDecklist(db, `Commander
1 Nonexistent Card (XYZ) 1
Deck
2 Lightning Bolt
0 Broken
Sideboard
1 Fire // Ice`);
    expect(r.resolved.commander).toEqual([]);
    expect(r.unknown).toEqual([{ line: 2, quantity: 1, name: 'Nonexistent Card', set: 'xyz', collectorNumber: '1' }]);
    expect(r.resolved.main[0]?.quantity).toBe(2);
    expect(r.resolved.sideboard[0]?.printing.name).toBe('Fire // Ice');
    expect(r.errors.map((e) => e.line)).toEqual([5]);
  });

  it('handles an empty list', async () => {
    expect(await resolveDecklist(db, '')).toEqual({ resolved: { main: [], sideboard: [], commander: [] }, unknown: [], warnings: [], errors: [] });
  });
});
