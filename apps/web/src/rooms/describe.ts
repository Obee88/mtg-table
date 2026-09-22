import type { RoomSettings } from '@mtg/shared';

export const describeSettings = (s: RoomSettings) =>
  `${s.draft ? `Draft: ${s.draft.name} · ` : ''}${s.mode === '1v1' ? '1v1' : s.mode === 'ffa' ? `${s.playerCount}-player FFA` : '2v2'} · ${s.startingLife} life${s.commander ? ' · commander' : ''}`;

export const PRESETS: { label: string; settings: RoomSettings }[] = [
  { label: '1v1 · 20 life', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } },
  { label: '1v1 Commander · 40 life', settings: { playerCount: 2, mode: '1v1', startingLife: 40, commander: true } },
  { label: '4-player free-for-all · 20 life', settings: { playerCount: 4, mode: 'ffa', startingLife: 20, commander: false } },
  { label: '4-player Commander · 40 life', settings: { playerCount: 4, mode: 'ffa', startingLife: 40, commander: true } },
  { label: '2v2 Two-Headed Giant · 30 life', settings: { playerCount: 4, mode: '2v2', startingLife: 30, commander: false } },
];
