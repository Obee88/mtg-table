import { describe, expect, it } from 'vitest';
import { rawCard } from '../test/cards.js';
import { mapCard } from './mapping.js';

describe('mapCard', () => {
  it('maps a normal card with a single synthetic face', () => {
    const row = mapCard(rawCard());
    expect(row).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Lightning Bolt',
      setCode: 'lea',
      collectorNumber: '161',
      releasedAt: '1993-08-05',
      cmc: 1,
      colors: ['R'],
      isToken: false,
      imageUris: { small: 'https://img/small.jpg', normal: 'https://img/normal.jpg' },
    });
    expect(row?.faces).toEqual([
      { name: 'Lightning Bolt', manaCost: '{R}', typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.', imageUris: row?.imageUris },
    ]);
  });

  it('uses the front face image for transform cards without a top-level image', () => {
    const row = mapCard(
      rawCard({
        layout: 'transform',
        image_uris: undefined,
        mana_cost: undefined,
        card_faces: [
          { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', image_uris: { normal: 'https://img/front.jpg' } },
          { name: 'Insectile Aberration', type_line: 'Creature — Human Insect', image_uris: { normal: 'https://img/back.jpg' } },
        ],
      }),
    );
    expect(row?.faces).toHaveLength(2);
    expect(row?.imageUris).toEqual({ normal: 'https://img/front.jpg' });
    expect(row?.manaCost).toBe('{U}');
  });

  it('flags tokens and takes oracle_id from faces when missing at top level', () => {
    const row = mapCard(
      rawCard({
        layout: 'token',
        set_type: 'token',
        oracle_id: undefined,
        card_faces: [{ name: 'Soldier', oracle_id: '33333333-3333-4333-8333-333333333333' }],
      }),
    );
    expect(row?.isToken).toBe(true);
    expect(row?.oracleId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('skips art series and unparseable objects', () => {
    expect(mapCard(rawCard({ layout: 'art_series' }))).toBeNull();
    expect(mapCard({ object: 'card', id: 'nope' })).toBeNull();
    expect(mapCard('garbage')).toBeNull();
  });
});
