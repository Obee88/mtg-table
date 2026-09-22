import type { RoomState } from '@mtg/shared';
import { attentionFor } from '@mtg/shared';
import { useEffect, useRef } from 'react';
import { BASE_TITLE, chime, notify, shouldCue, titleFor } from './cues';
import { useTablePref } from './prefs';

/**
 * Tells the player when the room waits on them: the tab title always; a
 * chime and a background notification when they opted in (UI preferences).
 */
export function useAttentionCues(state: RoomState | null, meId: string | undefined): void {
  const [sound] = useTablePref('sound');
  const [notifications] = useTablePref('notifications');
  const attention = state && meId ? attentionFor(state, meId) : null;
  const previous = useRef(attention);

  useEffect(() => {
    document.title = titleFor(attention, state?.name ?? null);
    return () => {
      document.title = BASE_TITLE;
    };
  }, [attention, state?.name]);

  useEffect(() => {
    const fresh = shouldCue(previous.current, attention);
    previous.current = attention;
    if (!fresh || !attention) return;
    if (sound) chime();
    if (notifications) notify(`${attention[0]!.toUpperCase()}${attention.slice(1)}`, state?.name ? `${state.name} is waiting for you.` : 'The table is waiting for you.');
  }, [attention, sound, notifications, state?.name]);
}
