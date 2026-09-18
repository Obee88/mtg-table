/**
 * Decklist text parser. Accepts the common export formats:
 *
 *   4 Lightning Bolt                      plain
 *   4x Lightning Bolt                     Archidekt / Cockatrice
 *   4 Lightning Bolt (LEA) 161            Arena / Moxfield (set + collector number)
 *   4 Lightning Bolt (LEA)                set only
 *   1 Sol Ring (C21) 263 *F*              foil marker (ignored)
 *   1x Sol Ring (c21) 263 [Ramp] ^Have^   Archidekt tags (ignored)
 *   SB: 4 Lightning Bolt                  Cockatrice sideboard prefix
 *   Lightning Bolt                        quantity defaults to 1
 *
 * Sections are switched by header lines (`Deck`, `Sideboard`, `Commander`,
 * `Maybeboard`, `Companion`, optionally prefixed with `//` and suffixed with
 * `:` or a count like `(15)`). Blank lines and `//` / `#` comment lines are
 * ignored; a blank line never changes the section. Names are kept verbatim
 * (case, `//` face separators) — resolution against card data happens later.
 */

export type DecklistSection = 'main' | 'sideboard' | 'commander' | 'maybeboard';

export interface DecklistEntry {
  /** 1-based line number in the source text. */
  line: number;
  quantity: number;
  name: string;
  /** Lower-cased set code, when the line specified one. */
  set?: string;
  collectorNumber?: string;
}

export interface DecklistError {
  line: number;
  text: string;
  message: string;
}

export interface ParsedDecklist {
  main: DecklistEntry[];
  sideboard: DecklistEntry[];
  commander: DecklistEntry[];
  maybeboard: DecklistEntry[];
  errors: DecklistError[];
}

const SECTION_HEADERS: Record<string, DecklistSection> = {
  deck: 'main',
  main: 'main',
  maindeck: 'main',
  mainboard: 'main',
  'main deck': 'main',
  sideboard: 'sideboard',
  side: 'sideboard',
  sb: 'sideboard',
  companion: 'sideboard',
  commander: 'commander',
  commanders: 'commander',
  'command zone': 'commander',
  maybeboard: 'maybeboard',
  maybe: 'maybeboard',
  considering: 'maybeboard',
};

const HEADER_RE = /^(?:\/\/\s*)?([A-Za-z][A-Za-z ]*?)\s*(?::|\(\d+\))?\s*$/;
const QUANTITY_RE = /^(\d+)\s*[xX]?\s+(.+)$/;
// "(SET) 123" or "(SET)" at the end of the name part. Collector numbers may
// contain letters and symbols (e.g. "161", "42a", "★12", "GN3-12").
const PRINTING_RE = /^(.+?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†\-.]+))?$/;
const TRAILING_JUNK_RE = /(\s+\*[A-Za-z]\*|\s+\[[^\]]*\]|\s+\^[^^]*\^|\s+#\S*)+$/;

export function parseDecklist(text: string): ParsedDecklist {
  const result: ParsedDecklist = { main: [], sideboard: [], commander: [], maybeboard: [], errors: [] };
  let section: DecklistSection = 'main';

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? '';
    const text = raw.trim();
    if (text.length === 0) continue;

    const header = parseHeader(text);
    if (header) {
      section = header;
      continue;
    }
    if (text.startsWith('//') || text.startsWith('#')) continue;

    let target = section;
    let body = text;
    const sb = /^SB:\s*(.+)$/i.exec(body);
    if (sb?.[1]) {
      target = 'sideboard';
      body = sb[1];
    }

    const entry = parseEntry(body, lineNo);
    if ('message' in entry) result.errors.push({ line: lineNo, text, message: entry.message });
    else result[target].push(entry);
  }
  return result;
}

function parseHeader(text: string): DecklistSection | null {
  const m = HEADER_RE.exec(text);
  if (!m?.[1]) return null;
  return SECTION_HEADERS[m[1].trim().toLowerCase()] ?? null;
}

function parseEntry(body: string, line: number): DecklistEntry | { message: string } {
  let quantity = 1;
  let rest = body;
  const q = QUANTITY_RE.exec(body);
  if (q?.[1] !== undefined && q[2] !== undefined) {
    quantity = Number(q[1]);
    rest = q[2];
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return { message: `Quantity must be between 1 and 999` };
  }

  rest = rest.replace(TRAILING_JUNK_RE, '').trim();
  const entry: DecklistEntry = { line, quantity, name: '' };

  const p = PRINTING_RE.exec(rest);
  if (p?.[1] && p[2]) {
    entry.name = p[1];
    entry.set = p[2].toLowerCase();
    if (p[3]) entry.collectorNumber = p[3];
  } else {
    entry.name = rest;
  }
  entry.name = entry.name.replace(/\s+/g, ' ').trim();
  if (entry.name.length === 0 || /^\d+$/.test(entry.name)) return { message: 'Missing card name' };
  return entry;
}

/** Sum of quantities. */
export function countCards(entries: readonly DecklistEntry[]): number {
  return entries.reduce((n, e) => n + e.quantity, 0);
}
