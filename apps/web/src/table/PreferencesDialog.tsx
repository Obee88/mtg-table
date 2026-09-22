import { useState } from 'react';
import { Dialog } from '../components';
import { TABLE_PREFS, useTablePref, type TablePref } from './prefs';

function PrefRow({ pref }: { pref: TablePref }) {
  const [on, set] = useTablePref(pref);
  const [permission, setPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const toggle = async (next: boolean) => {
    // Notifications need the browser's permission, asked for the moment the switch goes on.
    if (pref === 'notifications' && next && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') return set(false);
    }
    set(next);
  };
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => void toggle(e.target.checked)} disabled={pref === 'notifications' && (permission === 'unsupported' || permission === 'denied')} />
        <span>{TABLE_PREFS[pref].label}</span>
      </label>
      {pref === 'notifications' && permission === 'denied' && <p className="ml-7 text-xs text-text-muted">The browser has blocked notifications for this site; allow them in its site settings first.</p>}
      {pref === 'notifications' && permission === 'unsupported' && <p className="ml-7 text-xs text-text-muted">This browser does not support notifications.</p>}
    </li>
  );
}

/** What this browser shows and plays at the table; remembered per browser, nothing shared with the other players. */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="UI preferences" onClose={onClose}>
      <ul className="flex flex-col gap-2">
        {(Object.keys(TABLE_PREFS) as TablePref[]).map((p) => <PrefRow key={p} pref={p} />)}
      </ul>
      <p className="mt-4 text-xs text-text-muted">The tab title always shows what the table waits on from you. Saved in this browser only.</p>
    </Dialog>
  );
}
