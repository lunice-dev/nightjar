import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { setBlocked, useBlocked } from '../lib/blocking';
import { usePrefs, type Buddy } from '../prefs';
import { useStore } from '../store';

const seen = (b: Buddy) => {
  if (b.presence && b.presence !== 'Offline') return b.presence;
  if (!b.lastSeen) return b.presence ? 'Offline' : 'Checking…';
  const m = Math.round((Date.now() - b.lastSeen) / 60_000);
  return m < 60 ? `Last seen ${Math.max(1, m)} min ago` : m < 1440 ? `Last seen ${Math.round(m / 60)} h ago` : 'Offline';
};

export function PeopleScreen() {
  const buddies = usePrefs((s) => s.buddies);
  const ignored = usePrefs((s) => s.ignored);
  const addBuddy = usePrefs((s) => s.addBuddy);
  const unignore = usePrefs((s) => s.unignore);
  const openProfile = useStore((s) => s.openProfile);
  const [name, setName] = useState('');
  const { list: blocked, editable, reload } = useBlocked();
  useEffect(() => {
    reload();
  }, [reload]);

  const order = { Online: 0, Away: 1, Offline: 2 } as const;
  const sorted = [...buddies].sort(
    (a, b) => order[a.presence ?? 'Offline'] - order[b.presence ?? 'Offline'] || a.username.localeCompare(b.username),
  );
  const online = buddies.filter((b) => b.presence && b.presence !== 'Offline').length;

  return (
    <div className="page">
      <div className="page-inner narrow">
        <div className="page-head">
          <div>
            <h1 className="page-title">People</h1>
            <p className="page-sub">
              {buddies.length ? `${online} of ${buddies.length} online` : 'Keep the people you trade with close, and know when they’re around.'}
            </p>
          </div>
        </div>

        <form
          className="add-folder"
          onSubmit={(e) => {
            e.preventDefault();
            addBuddy(name);
            setName('');
          }}
        >
          <label htmlFor="add-person" className="sr-only">
            Username
          </label>
          <input id="add-person" className="input" placeholder="Username" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn quiet" type="submit" disabled={!name.trim()}>
            Add person
          </button>
          <button className="btn quiet" type="button" disabled={!name.trim()} onClick={() => openProfile(name.trim())}>
            Look up
          </button>
        </form>

        <FriendsFirstNote />

        {buddies.length === 0 ? (
          <p className="callout" style={{ marginTop: 16 }}>
            No one here yet. Add someone by name, or choose Add to people on anyone’s profile.
          </p>
        ) : (
          <ul className="buddies">
            {sorted.map((b) => (
              <BuddyRow key={b.username} b={b} />
            ))}
          </ul>
        )}

        <section className="settings-block" aria-labelledby="ignored-h">
          <h2 id="ignored-h">Ignored</h2>
          <p className="hint-text">You won’t see their messages, their lines in rooms, or their files in search results.</p>
          {ignored.length === 0 ? (
            <p className="hint-text dim">Nobody.</p>
          ) : (
            <ul className="chips">
              {ignored.map((u) => (
                <li key={u} className="chip plain">
                  {u}
                  <button className="link" onClick={() => unignore(u)}>
                    Stop ignoring
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-block" aria-labelledby="blocked-h">
          <h2 id="blocked-h">Can’t download from you</h2>
          <p className="hint-text">
            These people can still see you and talk to you, but Nightjar refuses their downloads.
            {!editable && ' To change this list here, turn on remote_configuration in the engine’s config (data\\slskd.yml).'}
          </p>
          {blocked === undefined ? (
            <span className="spinner" aria-label="Loading" />
          ) : blocked.length === 0 ? (
            <p className="hint-text dim">Nobody.</p>
          ) : (
            <ul className="chips">
              {blocked.map((u) => (
                <li key={u} className="chip plain">
                  <button className="user-link" onClick={() => openProfile(u)}>
                    {u}
                  </button>
                  <button
                    className="link"
                    disabled={!editable}
                    onClick={async () => {
                      await setBlocked(u, false);
                    }}
                  >
                    Share again
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function BuddyRow({ b }: { b: Buddy }) {
  const updateBuddy = usePrefs((s) => s.updateBuddy);
  const removeBuddy = usePrefs((s) => s.removeBuddy);
  const openProfile = useStore((s) => s.openProfile);
  const message = useStore((s) => s.message);
  const [note, setNote] = useState(b.note);
  const presence = (b.presence ?? 'Offline').toLowerCase();

  return (
    <li className="buddy">
      <span className={`presence ${b.presence ? presence : 'offline'}`} aria-hidden />
      <div className="buddy-main">
        <button className="user-link buddy-name" onClick={() => openProfile(b.username)}>
          {b.username}
        </button>
        <span className="dim buddy-seen">{seen(b)}</span>
        <label className="sr-only" htmlFor={`note-${b.username}`}>
          Note about {b.username}
        </label>
        <input
          id={`note-${b.username}`}
          className="note"
          placeholder="Add a note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== b.note && updateBuddy(b.username, { note })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="buddy-actions">
        <button
          className={`icon-btn ${b.alert ? 'on' : ''}`}
          aria-pressed={b.alert}
          title={b.alert ? 'Alert when online: on' : 'Alert when online: off'}
          aria-label={`Alert me when ${b.username} comes online`}
          onClick={() => updateBuddy(b.username, { alert: !b.alert })}
        >
          <Icon name="bell" size={16} />
        </button>
        <button className="icon-btn" aria-label={`Message ${b.username}`} onClick={() => message(b.username)}>
          <Icon name="chat" size={16} />
        </button>
        <button className="icon-btn" aria-label={`Remove ${b.username} from people`} onClick={() => removeBuddy(b.username)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </li>
  );
}

/** Whether your people skip your upload queue, with a way to turn it on. */
function FriendsFirstNote() {
  const backend = useStore((s) => s.backend);
  const go = useStore((s) => s.go);
  const [on, setOn] = useState<boolean>();
  useEffect(() => {
    backend
      ?.settings()
      .then((s) => setOn(s.friendsFirst))
      .catch(() => undefined);
  }, [backend]);
  if (on === undefined) return null;
  return (
    <p className="hint-text small friends-note">
      {on ? 'Friends first is on: the people here skip ahead in your upload queue.' : 'Want the people here to skip ahead in your upload queue?'}{' '}
      <button className="link" onClick={() => go('settings')}>
        {on ? 'Change' : 'Turn on Friends first'}
      </button>
    </p>
  );
}
