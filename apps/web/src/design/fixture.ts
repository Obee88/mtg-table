import { emptyPlayerGameState, type CardInstance, type PlayerGameState, type RoomState, type ZoneName } from '@mtg/shared';
import { FIXTURE_CARDS } from './fixtureCards';

export const ME = 'me';
export const OPP = 'opp';

const byName = (name: string) => {
  const p = FIXTURE_CARDS.find((c) => c.name === name || c.name.startsWith(`${name} //`));
  if (!p) throw new Error(`fixture card missing: ${name}`);
  return p;
};

let n = 0;
function card(owner: string, name: string | null, zone: ZoneName, extra: Partial<CardInstance> = {}): CardInstance {
  const p = name ? byName(name) : null;
  return {
    id: `f${++n}`,
    printingId: p?.id ?? null,
    ownerId: owner,
    controllerId: owner,
    zone,
    tapped: false,
    transformed: false,
    flipped: false,
    faceDown: false,
    counters: {},
    attachedTo: null,
    note: null,
    isToken: false,
    customName: null,
    visibleTo: zone === 'battlefield' || zone === 'graveyard' || zone === 'exile' || zone === 'stack' ? 'all' : zone === 'library' ? [] : 'owner',
    revealUntil: null,
    position: null,
    ...extra,
  };
}

/** A mid-game 1v1 as the viewer `me` would see it (opponent hand/library identities hidden). */
export function fixtureRoom(): RoomState {
  n = 0;
  const cards: CardInstance[] = [];
  const add = (c: CardInstance) => (cards.push(c), c);

  // My board
  const m1 = add(card(ME, 'Mountain', 'battlefield', { position: { row: 1, col: 0 }, tapped: true }));
  add(card(ME, 'Mountain', 'battlefield', { position: { row: 1, col: 1 } }));
  add(card(ME, 'Forest', 'battlefield', { position: { row: 1, col: 2 }, tapped: true }));
  add(card(ME, 'Forest', 'battlefield', { position: { row: 1, col: 3 } }));
  add(card(ME, 'Grizzly Bears', 'battlefield', { position: { row: 0, col: 0 }, counters: { '+1/+1': 2 } }));
  add(card(ME, 'Rancor', 'battlefield', { position: { row: 0, col: 0 } }));
  add(card(ME, 'Llanowar Elves', 'battlefield', { position: { row: 0, col: 1 }, tapped: true }));
  add(card(ME, 'Sol Ring', 'battlefield', { position: { row: 1, col: 4 }, note: 'copy' }));
  add(card(ME, 'Soldier', 'battlefield', { position: { row: 0, col: 2 }, isToken: true }));
  add(card(ME, 'Soldier', 'battlefield', { position: { row: 0, col: 2 }, isToken: true, tapped: true }));
  add(card(ME, null, 'battlefield', { position: { row: 0, col: 3 }, isToken: true, customName: 'Zombie 2/2' }));
  add(card(ME, 'Delver of Secrets', 'battlefield', { position: { row: 0, col: 4 }, transformed: true }));
  add(card(ME, 'Serra Angel', 'battlefield', { position: { row: 0, col: 5 }, faceDown: true, visibleTo: 'owner' }));
  for (const name of ['Lightning Bolt', 'Counterspell', 'Swords to Plowshares', 'Wrath of God', 'Jace, the Mind Sculptor', 'Island', 'Lightning Bolt']) add(card(ME, name, 'hand'));
  for (let i = 0; i < 46; i++) add(card(ME, null, 'library'));
  add(card(ME, 'Lightning Bolt', 'graveyard'));
  add(card(ME, 'Llanowar Elves', 'graveyard'));
  add(card(ME, 'Grizzly Bears', 'exile'));
  void m1;

  // Opponent board
  for (let i = 0; i < 5; i++) add(card(OPP, 'Island', 'battlefield', { position: { row: 1, col: i < 3 ? 0 : 1 }, tapped: i < 2 }));
  add(card(OPP, 'Serra Angel', 'battlefield', { position: { row: 0, col: 0 } }));
  add(card(OPP, 'Delver of Secrets', 'battlefield', { position: { row: 0, col: 1 }, counters: { '+1/+1': 1 } }));
  add(card(OPP, 'Jace, the Mind Sculptor', 'battlefield', { position: { row: 0, col: 2 }, counters: { loyalty: 4 } }));
  for (let i = 0; i < 5; i++) add(card(OPP, null, 'hand'));
  add(card(OPP, 'Lightning Bolt', 'hand', { visibleTo: 'all' })); // revealed to me
  for (let i = 0; i < 39; i++) add(card(OPP, null, 'library'));
  add(card(OPP, 'Counterspell', 'graveyard'));
  add(card(ME, 'Lightning Bolt', 'stack'));
  add(card(OPP, 'Counterspell', 'stack'));
  add(card(OPP, 'Wrath of God', 'graveyard'));

  const players: Record<string, PlayerGameState> = { [ME]: emptyPlayerGameState(20), [OPP]: emptyPlayerGameState(20) };
  players[ME]!.life = 17;
  players[ME]!.poison = 2;
  players[ME]!.counters = { energy: 3 };
  players[OPP]!.life = 12;
  for (const c of cards) players[c.ownerId]!.zones[c.zone].push(c.id);

  return {
    id: 'design',
    ownerId: ME,
    settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false },
    phase: 'playing',
    players: {
      [ME]: { id: ME, displayName: 'You', seat: 0, team: 0, deckId: 'd', ready: true },
      [OPP]: { id: OPP, displayName: 'Bob', seat: 1, team: 1, deckId: 'd', ready: true },
    },
    game: {
      cards: Object.fromEntries(cards.map((c) => [c.id, c])),
      players,
      teamLife: null,
      firstPlayerId: OPP,
      stack: cards.filter((c) => c.zone === 'stack').map((c) => c.id),
      openingRoll: { [ME]: 9, [OPP]: 14 },
      startedAt: new Date().toISOString(),
    },
    seq: 1,
  };
}
