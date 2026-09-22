import type { Attention } from '@mtg/shared';

export const BASE_TITLE = 'MTG Table';

/** The tab title for what the room waits on from me: a dot and the ask, so a background tab reads at a glance. */
export function titleFor(attention: Attention | null, roomName?: string | null): string {
  const where = roomName ? ` · ${roomName}` : '';
  return attention ? `● ${attention[0]!.toUpperCase()}${attention.slice(1)}${where} · ${BASE_TITLE}` : `${roomName ?? BASE_TITLE}${roomName ? ` · ${BASE_TITLE}` : ''}`;
}

/** Whether a change of attention deserves a chime or notification: only a fresh ask, not its going away, not the same ask repeated. */
export function shouldCue(previous: Attention | null, next: Attention | null): boolean {
  return next !== null && next !== previous;
}

/** A short two-note chime from the Web Audio API; no asset to load, nothing if audio is unavailable. */
export function chime(): void {
  try {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const at = ctx.currentTime;
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, at + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.18 + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + i * 0.18);
      osc.stop(at + i * 0.18 + 0.3);
    }
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // no audio: the title still changes
  }
}

/** A browser notification when the tab is in the background and permission was granted; clicking it brings the tab back. */
export function notify(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body, tag: 'mtg-table-attention' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // some browsers refuse constructing notifications outside a service worker; the title cue remains
  }
}
