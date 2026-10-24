import { useEffect, useState } from 'react';
import type { Room, RoomInfo } from '../api/types';
import { Composer, MessageList, type Line } from '../components/Chat';
import { Icon } from '../components/Icon';
import { speed } from '../lib/quality';
import { usePrefs } from '../prefs';
import { useStore } from '../store';

export function RoomsScreen() {
  const backend = useStore((s) => s.backend);
  const current = useStore((s) => s.room);
  const openRoom = useStore((s) => s.openRoom);
  const toast = useStore((s) => s.toast);
  const [joined, setJoined] = useState<string[]>([]);
  const [available, setAvailable] = useState<RoomInfo[]>();
  const [filter, setFilter] = useState('');

  const loadJoined = async () => {
    if (!backend) return;
    try {
      setJoined(await backend.joinedRooms());
    } catch {
      /* keep */
    }
  };

  useEffect(() => {
    loadJoined();
    backend
      ?.availableRooms()
      .then((r) => setAvailable(r.sort((a, b) => b.userCount - a.userCount)))
      .catch(() => setAvailable([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const join = async (name: string) => {
    try {
      await backend?.joinRoom(name);
      await loadJoined();
      openRoom(name);
    } catch (e) {
      toast(`Couldn't join ${name}: ${(e as Error).message}`, 'error');
    }
  };

  const leave = async (name: string) => {
    await backend?.leaveRoom(name).catch(() => undefined);
    await loadJoined();
    openRoom(undefined);
  };

  const f = filter.trim().toLowerCase();
  const shown = (available ?? []).filter((r) => !joined.includes(r.name) && (!f || r.name.toLowerCase().includes(f)));

  return (
    <div className="split">
      <aside className={`split-list ${current ? 'has-open' : ''}`} aria-label="Rooms">
        {joined.length > 0 && (
          <>
            <h2 className="list-head">Your rooms</h2>
            <ul className="convos">
              {joined.map((name) => (
                <li key={name}>
                  <button className="convo" aria-current={current === name} onClick={() => openRoom(name)}>
                    <span className="convo-name">{name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <h2 className="list-head">Find a room</h2>
        <div className="pad-x">
          <label htmlFor="room-filter" className="sr-only">
            Filter rooms
          </label>
          <input id="room-filter" className="input" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {available === undefined ? (
          <p className="hint-text pad">
            <span className="spinner" aria-hidden /> Loading the room list…
          </p>
        ) : (
          <ul className="convos">
            {shown.slice(0, 200).map((r) => (
              <li key={r.name}>
                <button className="convo room-row" onClick={() => join(r.name)}>
                  <span className="convo-name">{r.name}</span>
                  <span className="n">{r.userCount.toLocaleString()}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <p className="hint-text pad">No rooms match “{filter}”.</p>}
          </ul>
        )}
      </aside>
      <section className="split-main">
        {current && joined.includes(current) ? (
          <RoomView key={current} name={current} onLeave={() => leave(current)} />
        ) : (
          <div className="empty pad">
            <h2>Rooms</h2>
            <p>Public chat rooms, usually around a genre or a country. Pick one on the left to join. Busy rooms move fast, and you can leave any time.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function RoomView({ name, onLeave }: { name: string; onLeave: () => void }) {
  const backend = useStore((s) => s.backend);
  const me = useStore((s) => s.me);
  const openProfile = useStore((s) => s.openProfile);
  const message = useStore((s) => s.message);
  const toast = useStore((s) => s.toast);
  const ignored = usePrefs((s) => s.ignored);
  const [room, setRoom] = useState<Room>();
  const [showPeople, setShowPeople] = useState(false);

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await backend.room(name);
        if (alive) setRoom(r);
      } catch {
        /* keep last */
      }
    };
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [backend, name]);

  const lines: Line[] = (room?.messages ?? []).filter((m) => !ignored.includes(m.username)).map((m, i) => ({
    key: `${i}-${m.timestamp}`,
    username: m.username,
    text: m.message,
    timestamp: m.timestamp,
    mine: m.direction === 'Out' || m.username === me,
  }));
  const users = [...(room?.users ?? [])].sort((a, b) => a.username.localeCompare(b.username));

  return (
    <div className="room">
      <div className="thread">
        <header className="thread-head">
          <button className="icon-btn back" aria-label="Back to rooms" onClick={() => useStore.setState({ room: undefined })}>
            <Icon name="chevron" size={18} />
          </button>
          <h1 className="thread-title">{name}</h1>
          <button className="btn quiet small people-toggle" aria-expanded={showPeople} onClick={() => setShowPeople((v) => !v)}>
            <Icon name="person" size={16} /> {users.length}
          </button>
          <button className="btn quiet small" onClick={onLeave}>
            Leave
          </button>
        </header>
        <MessageList lines={lines} showNames empty={room ? 'Nobody has said anything since you joined.' : 'Joining…'} />
        <Composer
          placeholder={`Message ${name}`}
          onSend={async (t) => {
            try {
              await backend?.sendRoomMessage(name, t);
              setRoom(await backend!.room(name));
            } catch (e) {
              toast(`Message not sent: ${(e as Error).message}`, 'error');
              throw e;
            }
          }}
        />
      </div>
      <aside
        className={`people ${showPeople ? 'open' : ''}`}
        aria-label={`People in ${name}`}
        onKeyDown={(e) => e.key === 'Escape' && setShowPeople(false)}
      >
        <div className="people-head">
          <h2 className="list-head">{users.length} people here</h2>
          <button className="icon-btn people-close" aria-label="Close the people list" onClick={() => setShowPeople(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <ul>
          {users.map((u) => (
            <li key={u.username} className="person">
              <span className={`presence ${String(u.status ?? 'Online').toLowerCase()}`} aria-label={String(u.status ?? 'Online')} />
              <button className="user-link" onClick={() => openProfile(u.username)}>
                {u.username}
              </button>
              <span className="dim">{u.averageSpeed ? speed(u.averageSpeed) : ''}</span>
              {u.username !== me && (
                <button className="icon-btn" aria-label={`Message ${u.username}`} onClick={() => message(u.username)}>
                  <Icon name="chat" size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
