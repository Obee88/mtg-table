import type { BulkInfo, CardSource } from '../cards/scryfall.js';

/** Minimal Scryfall-shaped card objects for tests. */
export function rawCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'card',
    id: '11111111-1111-4111-8111-111111111111',
    oracle_id: '22222222-2222-4222-8222-222222222222',
    name: 'Lightning Bolt',
    lang: 'en',
    layout: 'normal',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    set_type: 'core',
    collector_number: '161',
    released_at: '1993-08-05',
    rarity: 'common',
    type_line: 'Instant',
    mana_cost: '{R}',
    cmc: 1,
    colors: ['R'],
    color_identity: ['R'],
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    image_uris: { small: 'https://img/small.jpg', normal: 'https://img/normal.jpg' },
    digital: false,
    promo: false,
    ...overrides,
  };
}

export function fakeSource(cards: unknown[], info: Partial<BulkInfo> = {}): CardSource & { calls: number } {
  const source = {
    calls: 0,
    async bulkInfo() {
      return { updatedAt: '2026-09-18T09:05:32Z', downloadUri: 'fake://cards', compressedSize: 0, ...info };
    },
    async *cards() {
      source.calls++;
      yield* cards;
    },
  };
  return source;
}
