import { useEffect, useState } from 'react';
import { onThisComputer } from '../api/remote';
import type { Settings } from '../api/types';
import { setBlocked } from '../lib/blocking';
import { useGuard } from '../lib/guard';
import { useStore } from '../store';

/** What Nightjar suggests for the limits: roughly seven albums waiting at once and sixteen albums a day. */
const RECOMMENDED = { queued: 100, daily: 400 };

const when = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Settings: keeping programs away. Nightjar blocks anyone using your share far faster than a person can, and caps
 * what one person can queue and take, so nobody can drain the library by machine.
 */
export function GuardSection({ settings, readOnly, onSaved }: { settings: Settings; readOnly: boolean; onSaved: () => Promise<boolean> }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const auto = useGuard((s) => s.auto);
  const setAuto = useGuard((s) => s.setAuto);
  const blocked = useGuard((s) => s.blocked);
  const allow = useGuard((s) => s.allow);
  const [queued, setQueued] = useState(String(settings.personLimits.queued));
  const [daily, setDaily] = useState(settings.personLimits.daily?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setQueued(String(settings.personLimits.queued));
    setDaily(settings.personLimits.daily?.toString() ?? '');
  }, [settings.personLimits.queued, settings.personLimits.daily]);

  const nextQueued = Math.max(1, parseInt(queued, 10) || settings.personLimits.queued);
  const nextDaily = daily.trim() === '' ? null : Math.max(1, parseInt(daily, 10) || 0) || null;
  const dirty = nextQueued !== settings.personLimits.queued || nextDaily !== settings.personLimits.daily;

  const save = async () => {
    setSaving(true);
    try {
      await backend!.saveSettings({ personLimits: { queued: nextQueued, daily: nextDaily } });
      const pending = await onSaved();
      toast(pending ? 'Saved. Restart to start using the new limits.' : 'Limits saved');
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const undo = async (user: string) => {
    if (await setBlocked(user, false)) allow(user);
  };

  return (
    <section className="settings-block" id="programs" aria-labelledby="programs-h">
      <h2 id="programs-h">Programs and heavy downloading</h2>
      <p className="hint-text">
        Nightjar is for people. When something uses your share far faster than a person could, it gets blocked, and nobody can take more than
        the limits below.
      </p>

      <label className="toggle" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={auto} disabled={!onThisComputer} onChange={(e) => setAuto(e.target.checked)} />
        <span>
          Block programs automatically
          <small className="dim" style={{ display: 'block' }}>
            Anyone who opens more than 40 of your folders in a minute, asks for 1,000 files in half an hour or takes 800 files in an hour is blocked
            at once and their downloads stop. People on your People list are never blocked.
            {!onThisComputer && ' This runs on the computer where Nightjar is installed.'}
          </small>
        </span>
      </label>

      <h3 className="sub-h">What one person can take</h3>
      <div className="speed-grid">
        <label className="field" htmlFor="limit-queued">
          Files waiting at once
          <span className="unit-input">
            <input id="limit-queued" className="input" inputMode="numeric" value={queued} disabled={readOnly} onChange={(e) => setQueued(e.target.value.replace(/\D/g, ''))} />
            <span>files</span>
          </span>
        </label>
        <label className="field" htmlFor="limit-daily">
          Files a day
          <span className="unit-input">
            <input id="limit-daily" className="input" inputMode="numeric" placeholder="No limit" value={daily} disabled={readOnly} onChange={(e) => setDaily(e.target.value.replace(/\D/g, ''))} />
            <span>files</span>
          </span>
        </label>
      </div>
      <p className="hint-text small">
        An album is 10 to 25 files. Nightjar suggests {RECOMMENDED.queued} waiting at once and {RECOMMENDED.daily} a day, enough for several albums a day and far
        too little for a machine. Without a daily limit, slskd still stops one person at 1,500 files a week.
      </p>
      <div className="save-row tight">
        <button className="btn" disabled={readOnly || !dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save limits'}
        </button>
        <button
          className="link"
          disabled={readOnly || saving}
          onClick={() => {
            setQueued(String(RECOMMENDED.queued));
            setDaily(String(RECOMMENDED.daily));
          }}
        >
          Use the suggested limits
        </button>
      </div>

      {blocked.length > 0 && (
        <>
          <h3 className="sub-h">Blocked automatically</h3>
          <ul className="guard-blocked">
            {blocked.map((b) => (
              <li key={b.user}>
                <span>
                  <b>{b.user}</b>
                  <small className="dim">
                    {when(b.at)}: {b.summary}
                  </small>
                </span>
                <button className="link" disabled={readOnly} onClick={() => undo(b.user)}>
                  Allow again
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
