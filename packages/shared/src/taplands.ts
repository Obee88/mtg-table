/** Which face of a card is the land that enters tapped: the front for ordinary lands, the back for modal double-faced spells with a land on the back. */
export type TaplandFace = 'front' | 'back';

export interface TaplandCandidate {
  typeLine: string | null;
  oracleText: string | null;
  faces: { typeLine: string | null; oracleText: string | null }[];
}

export interface TaplandSuggestion {
  face: TaplandFace;
  /** The sentence of rules text that gave it away. */
  sentence: string;
}

/**
 * Oracle wording for entering tapped, past and present: "enters tapped"
 * (2024 onwards), "enters the battlefield tapped", "comes into play tapped".
 */
const ENTERS_TAPPED = /\b(enters|comes into play)( the battlefield)? tapped\b/i;
/**
 * Words that make it conditional or optional, so the card does not *always*
 * enter tapped: shock lands ("if you don't"), check/fast/slow lands ("unless"),
 * reveal lands ("you may"), Battlebond lands ("unless you have two or more
 * opponents"), and the like. Those are left for a human to decide.
 */
const CONDITIONAL = /\b(unless|if|may|otherwise|instead|as long as)\b/i;

/** The first sentence of `text` that says the card enters tapped with no strings attached, or null. */
export function taplandSentence(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.trim();
    if (ENTERS_TAPPED.test(s) && !CONDITIONAL.test(s)) return s;
  }
  return null;
}

/** Whether a land face of the card always enters tapped, judging by its rules text. */
export function detectTapland(card: TaplandCandidate): TaplandSuggestion | null {
  const faces = card.faces.length > 0 ? card.faces : [{ typeLine: card.typeLine, oracleText: card.oracleText }];
  for (let i = 0; i < Math.min(faces.length, 2); i++) {
    const f = faces[i]!;
    if (!/\bLand\b/.test(f.typeLine ?? '')) continue;
    const sentence = taplandSentence(f.oracleText ?? (faces.length === 1 ? card.oracleText : null));
    if (sentence) return { face: i === 0 ? 'front' : 'back', sentence };
  }
  return null;
}

/** Whether a card with the given tapland face enters tapped when it comes in showing `transformed`'s face. */
export function entersTapped(face: TaplandFace | null | undefined, transformed: boolean): boolean {
  return face === (transformed ? 'back' : 'front');
}
