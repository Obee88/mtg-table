import type { CardFace, DeckContents, DraftConfig, GameEvent, RoomSettings, RoomState } from '@mtg/shared';
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export type UserRow = typeof users.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;

/** One row per Scryfall printing (from the `default_cards` bulk file). */
export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey(), // Scryfall card id
    oracleId: uuid('oracle_id'),
    name: text('name').notNull(),
    lang: text('lang').notNull(),
    layout: text('layout').notNull(),
    setCode: text('set_code').notNull(),
    setName: text('set_name').notNull(),
    setType: text('set_type').notNull(),
    collectorNumber: text('collector_number').notNull(),
    releasedAt: date('released_at').notNull(),
    rarity: text('rarity').notNull(),
    typeLine: text('type_line'),
    manaCost: text('mana_cost'),
    cmc: real('cmc'),
    colors: text('colors').array(),
    colorIdentity: text('color_identity').array().notNull(),
    oracleText: text('oracle_text'),
    /** Front-face images: { small, normal, large, png, art_crop, border_crop }. */
    imageUris: jsonb('image_uris').$type<Record<string, string>>(),
    /** All faces; length 1 for ordinary cards. */
    faces: jsonb('faces').$type<CardFace[]>().notNull(),
    isToken: boolean('is_token').notNull().default(false),
    isDigital: boolean('is_digital').notNull().default(false),
    isPromo: boolean('is_promo').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cards_name_lower_idx').on(sql`lower(${t.name})`),
    index('cards_oracle_id_idx').on(t.oracleId),
    index('cards_set_code_idx').on(t.setCode),
  ],
);


export const cardIngests = pgTable('card_ingests', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status', { enum: ['running', 'success', 'failed'] }).notNull(),
  /** Scryfall's `updated_at` for the bulk file that was ingested. */
  bulkUpdatedAt: text('bulk_updated_at'),
  processed: integer('processed').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
});

export type CardRow = typeof cards.$inferSelect;
export type NewCardRow = typeof cards.$inferInsert;
export type CardIngestRow = typeof cardIngests.$inferSelect;

export const decks = pgTable(
  'decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contents: jsonb('contents').$type<DeckContents>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('decks_owner_id_idx').on(t.ownerId)],
);

export type DeckRow = typeof decks.$inferSelect;

// ---- rooms: event-sourced ----

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phase: text('phase', { enum: ['lobby', 'drafting', 'deckbuilding', 'playing', 'ended'] }).notNull().default('lobby'),
    settings: jsonb('settings').$type<RoomSettings>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rooms_phase_idx').on(t.phase)],
);

/** Denormalised membership for "my rooms" queries; the event log is the truth. */
export const roomPlayers = pgTable(
  'room_players',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index('room_players_user_id_idx').on(t.userId)],
);

export const roomEvents = pgTable(
  'room_events',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    actorId: uuid('actor_id'),
    /** Events produced by the same command share a batch id; undo works per batch. */
    batchId: uuid('batch_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<GameEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.seq] })],
);

export const roomSnapshots = pgTable('room_snapshots', {
  roomId: uuid('room_id')
    .primaryKey()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  state: jsonb('state').$type<RoomState>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RoomRow = typeof rooms.$inferSelect;

// ---- cubes: versioned lists of printings ----

export const cubes = pgTable(
  'cubes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cubes_owner_id_idx').on(t.ownerId)],
);

/** Every save is a full snapshot; `number` increases per cube. */
export const cubeVersions = pgTable(
  'cube_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cubeId: uuid('cube_id')
      .notNull()
      .references(() => cubes.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cube_versions_cube_id_idx').on(t.cubeId)],
);

export const cubeVersionCards = pgTable(
  'cube_version_cards',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => cubeVersions.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    quantity: integer('quantity').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.cardId] })],
);

export type CubeRow = typeof cubes.$inferSelect;
export type CubeVersionRow = typeof cubeVersions.$inferSelect;

// ---- draft picks: denormalised from `draftPicked` events for statistics ----

export const draftPicks = pgTable(
  'draft_picks',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** Overall pick number within the draft (1-based). */
    overallPick: integer('overall_pick').notNull(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    phase: integer('phase').notNull(),
    round: integer('round').notNull(),
    packId: text('pack_id').notNull(),
    /** 1-based position within the pack (how many cards had already left it + 1). */
    pickInPack: integer('pick_in_pack').notNull(),
    /** Printing ids the pack held when the pick was made, including the chosen one. */
    packContents: jsonb('pack_contents').$type<string[]>().notNull(),
    doublePick: boolean('double_pick').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.overallPick] }), index('draft_picks_player_id_idx').on(t.playerId), index('draft_picks_card_id_idx').on(t.cardId)],
);

export type DraftPickRow = typeof draftPicks.$inferSelect;

// ---- draft configs: saved, user-owned draft recipes ----

export const draftConfigs = pgTable(
  'draft_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    config: jsonb('config').$type<DraftConfig>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('draft_configs_owner_id_idx').on(t.ownerId)],
);

export type DraftConfigRow = typeof draftConfigs.$inferSelect;
