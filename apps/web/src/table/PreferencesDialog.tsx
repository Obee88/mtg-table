import { Dialog } from '../components';
import { TABLE_PREFS, useTablePref, type TablePref } from './prefs';

function PrefRow({ pref }: { pref: TablePref }) {
  const [on, set] = useTablePref(pref);
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
        <span>{TABLE_PREFS[pref].label}</span>
      </label>
    </li>
  );
}

/** What this browser shows at the table; remembered per browser, nothing shared with the other players. */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="UI preferences" onClose={onClose}>
      <ul className="flex flex-col gap-2">
        {(Object.keys(TABLE_PREFS) as TablePref[]).map((p) => <PrefRow key={p} pref={p} />)}
      </ul>
      <p className="mt-4 text-xs text-text-muted">Saved in this browser only.</p>
    </Dialog>
  );
}
