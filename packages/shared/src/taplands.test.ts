import { describe, expect, it } from 'vitest';
import { detectTapland, entersTapped, taplandSentence } from './taplands.js';

const land = (oracleText: string, typeLine = 'Land'): Parameters<typeof detectTapland>[0] => ({ typeLine, oracleText, faces: [{ typeLine, oracleText }] });

describe('detectTapland', () => {
  it('finds lands that always enter tapped, in every era of wording', () => {
    expect(detectTapland(land('Thornwood Falls enters tapped.\nWhen Thornwood Falls enters, you gain 1 life.\n{T}: Add {G} or {U}.'))).toEqual({ face: 'front', sentence: 'Thornwood Falls enters tapped.' });
    expect(detectTapland(land('Dimir Aqueduct enters the battlefield tapped.\nWhen Dimir Aqueduct enters the battlefield, return a land you control to its owner\'s hand.'))?.face).toBe('front');
    expect(detectTapland(land('Coastal Tower comes into play tapped.\n{T}: Add {W} or {U}.'))?.face).toBe('front');
    expect(detectTapland(land('This land enters tapped.\n{T}: Add {R}.'))?.face).toBe('front');
    expect(detectTapland(land('Celestial Colonnade enters tapped.\n{T}: Add {W} or {U}.\n{3}{W}{U}: Until end of turn, Celestial Colonnade becomes a 4/4 white and blue Elemental creature with flying and vigilance. It\'s still a land.'))?.face).toBe('front');
  });

  it('leaves conditional and optional cases to a human', () => {
    expect(detectTapland(land('As Steam Vents enters, you may pay 2 life. If you don\'t, it enters tapped.'))).toBeNull(); // shock
    expect(detectTapland(land('Sunpetal Grove enters tapped unless you control a Forest or a Plains.'))).toBeNull(); // check
    expect(detectTapland(land('Seachrome Coast enters tapped unless you control two or fewer other lands.'))).toBeNull(); // fast
    expect(detectTapland(land('Deserted Beach enters tapped unless you control two or more other lands.'))).toBeNull(); // slow
    expect(detectTapland(land('Morphic Pool enters tapped unless you have two or more opponents.'))).toBeNull(); // Battlebond
    expect(detectTapland(land('As Necroblossom Snarl enters, you may reveal a Swamp or Forest card from your hand. If you don\'t, Necroblossom Snarl enters tapped.'))).toBeNull(); // reveal
    expect(detectTapland(land('Prairie Stream enters tapped unless you control two or more basic lands.'))).toBeNull(); // tango
    expect(detectTapland(land('{T}: Add {C}.'))).toBeNull();
  });

  it('ignores non-lands and finds the land on the back of a modal double-faced card', () => {
    expect(detectTapland({ typeLine: 'Enchantment', oracleText: 'Creatures your opponents control enter tapped.', faces: [{ typeLine: 'Enchantment', oracleText: 'Creatures your opponents control enter tapped.' }] })).toBeNull();
    const mdfc = { typeLine: 'Sorcery // Land', oracleText: null, faces: [{ typeLine: 'Sorcery', oracleText: 'Return target card from your graveyard to your hand.' }, { typeLine: 'Land', oracleText: 'Bala Ged Sanctuary enters tapped.\n{T}: Add {G}.' }] };
    expect(detectTapland(mdfc)).toEqual({ face: 'back', sentence: 'Bala Ged Sanctuary enters tapped.' });
    const pathway = { typeLine: 'Land // Land', oracleText: null, faces: [{ typeLine: 'Land', oracleText: '{T}: Add {R}.' }, { typeLine: 'Land', oracleText: '{T}: Add {W}.' }] };
    expect(detectTapland(pathway)).toBeNull();
  });

  it('exposes the matching sentence and the face rule', () => {
    expect(taplandSentence('Blah. Foo enters tapped. Bar.')).toBe('Foo enters tapped.');
    expect(entersTapped('front', false)).toBe(true);
    expect(entersTapped('front', true)).toBe(false);
    expect(entersTapped('back', true)).toBe(true);
    expect(entersTapped(null, false)).toBe(false);
  });
});
