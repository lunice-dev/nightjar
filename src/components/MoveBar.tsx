import { bytes } from '../lib/quality';
import { timeLeftText, type MoveView } from '../lib/moveProgress';

/**
 * A thin line and one sentence while an album is copied to another drive: how much is done and how long is left.
 * Nothing shows for a move within one drive (it is instant) or before the copy has started.
 */
export function MoveBar({ view }: { view: MoveView | null }) {
  if (!view) return null;
  const { progress: p, left } = view;
  const total = p.total ?? 0;
  const done = Math.min(total, p.done ?? 0);
  const fraction = total > 0 ? done / total : 0;
  const text =
    p.phase === 'finishing'
      ? 'Copied. Clearing the original from Downloads…'
      : `${bytes(done)} of ${bytes(total)} · ${left === null ? 'working out the time…' : timeLeftText(left)}`;
  return (
    <div className="move-bar" role="progressbar" aria-label="Copying the album to your library" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div className="move-track">
        <i style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="move-text">{text}</p>
    </div>
  );
}
