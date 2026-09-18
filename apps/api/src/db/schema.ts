import type { CardFace, DeckContents, GameEvent, RoomSettings, RoomState } from '@mtg/shared';
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
    phase: text('phase', { enum: ['lobby', 'playing', 'ended'] }).notNull().default('lobby'),
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
