import { describe, expect, it } from 'vitest';
import { countCards, parseDecklist } from './decklist.js';

describe('parseDecklist', () => {
  it('parses plain, x-suffixed, unquantified and printing-qualified lines', () => {
    const r = parseDecklist(`4 Lightning Bolt
2x Counterspell
Sol Ring
1 Delver of Secrets // Insectile Aberration (ISD) 51
3 Opt (xln)
`);
    expect(r.errors).toEqual([]);
    expect(r.main).toEqual([
      { line: 1, quantity: 4, name: 'Lightning Bolt' },
      { line: 2, quantity: 2, name: 'Counterspell' },
      { line: 3, quantity: 1, name: 'Sol Ring' },
      { line: 4, quantity: 1, name: 'Delver of Secrets // Insectile Aberration', set: 'isd', collectorNumber: '51' },
      { line: 5, quantity: 3, name: 'Opt', set: 'xln' },
    ]);
    expect(countCards(r.main)).toBe(11);
  });

  it('switches sections on headers and SB: prefixes, ignores comments and blank lines', () => {
    const r = parseDecklist(`// My deck
Commander
1 Atraxa, Praetors' Voice

Deck
# ramp
1 Sol Ring

Sideboard (2)
2 Rest in Peace
SB: 1 Damping Sphere
Maybeboard:
1 Thoughtseize
`);
    expect(r.errors).toEqual([]);
    expect(r.commander.map((e) => e.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(r.main.map((e) => e.name)).toEqual(['Sol Ring']);
    expect(r.sideboard.map((e) => [e.quantity, e.name])).toEqual([[2, 'Rest in Peace'], [1, 'Damping Sphere']]);
    expect(r.maybeboard.map((e) => e.name)).toEqual(['Thoughtseize']);
  });

  it('accepts // Sideboard style headers and Companion as sideboard', () => {
    const r = parseDecklist(`4 Opt
// Sideboard
1 Negate
Companion
1 Lurrus of the Dream-Den
`);
    expect(r.main).toHaveLength(1);
    expect(r.sideboard.map((e) => e.name)).toEqual(['Negate', 'Lurrus of the Dream-Den']);
  });

  it('strips foil markers and Archidekt tags, keeps parenthesised card names', () => {
    const r = parseDecklist(`1 Sol Ring (C21) 263 *F*
1x Arcane Signet (c21) 240 [Ramp] ^Have,#f0f0f0^
1 Erase (Not the Urza's Legacy One)
1 Hazmat Suit (Used) (UNH) 92
`);
    expect(r.errors).toEqual([]);
    expect(r.main).toEqual([
      { line: 1, quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263' },
      { line: 2, quantity: 1, name: 'Arcane Signet', set: 'c21', collectorNumber: '240' },
      { line: 3, quantity: 1, name: "Erase (Not the Urza's Legacy One)" },
      { line: 4, quantity: 1, name: 'Hazmat Suit (Used)', set: 'unh', collectorNumber: '92' },
    ]);
  });

  it('handles odd collector numbers and CRLF input', () => {
    const r = parseDecklist('1 Brainstorm (SLD) 42a\r\n1 Ponder (PLST) C18-81\r\n1 Foo (TSR) ★12');
    expect(r.main.map((e) => e.collectorNumber)).toEqual(['42a', 'C18-81', '★12']);
  });

  it('reports bad lines with their line numbers and keeps going', () => {
    const r = parseDecklist(`4 Lightning Bolt
0 Nothing
4
1000 Too Many
2 Counterspell
`);
    expect(r.main.map((e) => e.name)).toEqual(['Lightning Bolt', 'Counterspell']);
    expect(r.errors).toEqual([
      { line: 2, text: '0 Nothing', message: 'Quantity must be between 1 and 999' },
      { line: 3, text: '4', message: 'Missing card name' },
      { line: 4, text: '1000 Too Many', message: 'Quantity must be between 1 and 999' },
    ]);
  });

  it('does not treat card names that look like headers as headers when quantified', () => {
    const r = parseDecklist(`1 Commander's Sphere
1 Sideboard Man`);
    expect(r.main.map((e) => e.name)).toEqual(["Commander's Sphere", 'Sideboard Man']);
  });

  it('returns empty sections for empty input', () => {
    expect(parseDecklist('')).toEqual({ main: [], sideboard: [], commander: [], maybeboard: [], errors: [] });
  });
});
