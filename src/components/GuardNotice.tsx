import { useState } from 'react';
import { blockAndStop, setBlocked, useBlocked } from '../lib/blocking';
import { useGuard, useSuspects } from '../lib/guard';
import { useStore } from '../store';

/**
 * Who looks like a program (a crawler or a mass downloader) in the last day, with what to do about it:
 * block them, say they're fine, or, when Nightjar already blocked them, allow them again.
 */
export function GuardNotice() {
  const suspects = useSuspects();
  const { list: blockedList } = useBlocked();
  const autoBlocked = useGuard((s) => s.blocked);
  const allow = useGuard((s) => s.allow);
  const openProfile = useStore((s) => s.openProfile);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = suspects
    .map((s) => ({ s, blocked: !!blockedList?.includes(s.user), byNightjar: autoBlocked.some((b) => b.user === s.user) }))
    // Someone you blocked yourself needs no notice.
    .filter((r) => !r.blocked || r.byNightjar)
    .slice(0, 4);
  if (rows.length === 0) return null;

  const block = async (user: string) => {
    setBusy(user);
    await blockAndStop(user);
    setBusy(null);
  };
  const undo = async (user: string) => {
    setBusy(user);
    if (await setBlocked(user, false)) allow(user);
    setBusy(null);
  };

  return (
    <ul className="guard-notes" aria-label="People who look like programs">
      {rows.map(({ s, blocked }) => (
        <li key={s.user}>
          <p>
            <button className="user-link" onClick={() => openProfile(s.user)}>
              {s.user}
            </button>{' '}
            {blocked ? 'was blocked automatically' : 'looks like a program'}: {s.summary.charAt(0).toLowerCase()}
            {s.summary.slice(1)}.
          </p>
          <span className="guard-actions">
            {blocked ? (
              <button className="link" disabled={busy === s.user} onClick={() => undo(s.user)}>
                Allow again
              </button>
            ) : (
              <>
                <button className="btn small" disabled={busy === s.user} onClick={() => block(s.user)}>
                  Block
                </button>
                <button className="link" disabled={busy === s.user} onClick={() => allow(s.user)}>
                  Not a program
                </button>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
