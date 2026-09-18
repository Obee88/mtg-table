import { z } from 'zod';
import type { CardFace } from '@mtg/shared';
import type { NewCardRow } from '../db/index.js';

const imageUris = z.record(z.string(), z.string());

const faceSchema = z.looseObject({
  name: z.string(),
  mana_cost: z.string().optional(),
  type_line: z.string().optional(),
  oracle_text: z.string().optional(),
  image_uris: imageUris.optional(),
});

const cardSchema = z.looseObject({
  object: z.literal('card'),
  id: z.uuid(),
  oracle_id: z.uuid().optional(),
  name: z.string(),
  lang: z.string(),
  layout: z.string(),
  set: z.string(),
  set_name: z.string(),
  set_type: z.string(),
  collector_number: z.string(),
  released_at: z.string(),
  rarity: z.string(),
  type_line: z.string().optional(),
  mana_cost: z.string().optional(),
  cmc: z.number().optional(),
  colors: z.array(z.string()).optional(),
  color_identity: z.array(z.string()),
  oracle_text: z.string().optional(),
  image_uris: imageUris.optional(),
  card_faces: z.array(faceSchema).optional(),
  digital: z.boolean().optional(),
  promo: z.boolean().optional(),
});

/** Layouts that are not playable cards and never belong in a deck or cube. */
const SKIPPED_LAYOUTS = new Set(['art_series']);

/**
 * Maps a raw Scryfall card object to a row. Returns null for objects we do not
 * store (unparseable or non-card layouts).
 */
export function mapCard(raw: unknown): NewCardRow | null {
  const parsed = cardSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  if (SKIPPED_LAYOUTS.has(c.layout)) return null;

  const faces: CardFace[] = (c.card_faces ?? []).map((f) => ({
    name: f.name,
    manaCost: f.mana_cost ?? null,
    typeLine: f.type_line ?? null,
    oracleText: f.oracle_text ?? null,
    imageUris: f.image_uris ?? null,
  }));
  if (faces.length === 0) {
    faces.push({
      name: c.name,
      manaCost: c.mana_cost ?? null,
      typeLine: c.type_line ?? null,
      oracleText: c.oracle_text ?? null,
      imageUris: c.image_uris ?? null,
    });
  }

  // Multi-face cards without a top-level image use the front face's image.
  const oracleId = c.oracle_id ?? oracleIdFromFaces(raw);
  const isToken = c.layout === 'token' || c.layout === 'double_faced_token' || c.set_type === 'token';

  return {
    id: c.id,
    oracleId: oracleId ?? null,
    name: c.name,
    lang: c.lang,
    layout: c.layout,
    setCode: c.set,
    setName: c.set_name,
    setType: c.set_type,
    collectorNumber: c.collector_number,
    releasedAt: c.released_at,
    rarity: c.rarity,
    typeLine: c.type_line ?? faces[0]?.typeLine ?? null,
    manaCost: c.mana_cost ?? faces[0]?.manaCost ?? null,
    cmc: c.cmc ?? null,
    colors: c.colors ?? null,
    colorIdentity: c.color_identity,
    oracleText: c.oracle_text ?? null,
    imageUris: c.image_uris ?? faces[0]?.imageUris ?? null,
    faces,
    isToken,
    isDigital: c.digital ?? false,
    isPromo: c.promo ?? false,
    updatedAt: new Date(),
  };
}

// Reversible cards carry oracle_id only on their faces.
function oracleIdFromFaces(raw: unknown): string | undefined {
  const faces = (raw as { card_faces?: { oracle_id?: unknown }[] }).card_faces;
  const id = faces?.[0]?.oracle_id;
  return typeof id === 'string' ? id : undefined;
}
