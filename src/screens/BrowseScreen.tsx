import { useEffect, useMemo, useState } from 'react';
import type { BrowseDirectory, BrowseResult, UserInfo, UserStatus } from '../api/types';
import { Icon } from '../components/Icon';
import { bytes, duration, formatLabel, isAudio, tierOf } from '../lib/quality';
import { setBlocked } from '../lib/blocking';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { useShareVersion } from '../lib/shareVersion';

interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  dir?: BrowseDirectory;
  total: number;
}

function buildTree(dirs: BrowseDirectory[]): Node {
  const root: Node = { name: '', path: '', children: new Map(), total: 0 };
  for (const d of dirs) {
    const parts = d.name.split(/[\\/]/).filter(Boolean);
    let node = root;
    let path = '';
    for (const part of parts) {
      path = path ? `${path}\\${part}` : part;
      let next = node.children.get(part);
      if (!next) {
        next = { name: part, path, children: new Map(), total: 0 };
        node.children.set(part, next);
      }
      next.total += d.fileCount;
      node = next;
    }
    node.dir = d;
  }
  // Collapse single-child chains like "@@abcde > Music" so the tree starts where it gets interesting.
  const collapse = (n: Node): Node => {
    n.children.forEach((c, k) => n.children.set(k, collapse(c)));
    if (!n.dir && n.children.size === 1 && n.name) {
      const [only] = n.children.values();
      return { ...only, name: `${n.name}\\${only.name}` };
    }
    return n;
  };
  return collapse(root);
}

export function BrowseScreen() {
  const user = useStore((s) => s.browseUser);
  const browse = useStore((s) => s.browse);
  const backend = useStore((s) => s.backend);
  const me = useStore((s) => s.me);
  const message = useStore((s) => s.message);
  const [input, setInput] = useState(user ?? '');
  const [state, setState] = useState<{ loading: boolean; result?: BrowseResult; error?: string }>({ loading: false });
  const [selected, setSelected] = useState<string>();
  const version = useShareVersion(!!user && user === me);

  useEffect(() => {
    setInput(user ?? '');
    if (!user || !backend) return;
    let cancelled = false;
    setState((s) => ({ loading: true, result: version && user === me ? s.result : undefined }));
    if (!version) setSelected(undefined);
    backend
      .browse(user)
      .then((result) => !cancelled && setState({ loading: false, result }))
      .catch((e: { status?: number; message: string }) =>
        !cancelled &&
        setState({
          loading: false,
          error: e.status === 404 ? `${user} is offline right now.` : `Couldn't load ${user}'s shares: ${e.message}`,
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [user, backend, version, me]);

  const tree = useMemo(() => (state.result ? buildTree(state.result.directories) : undefined), [state.result]);
  const dir = state.result?.directories.find((d) => d.name === selected);
  const total = state.result?.directories.reduce((s, d) => s + d.fileCount, 0) ?? 0;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">{user ? user : 'Browse a person'}</h1>
            <p className="page-sub">
              {state.loading
                ? 'Asking for their file list…'
                : state.result
                  ? `${state.result.directories.length} folders, ${total} files shared`
                  : 'See everything someone shares, folder by folder.'}
            </p>
          </div>
          {user && user !== me && <PersonActions user={user} onMessage={() => message(user)} />}
        </div>
        {user && <Profile key={user} user={user} />}
        <form
          className="browse-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) browse(input.trim());
          }}
        >
          <input
            className="input"
            placeholder="Username"
            aria-label="Username"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn" type="submit" disabled={!input.trim()}>
            Browse
          </button>
        </form>

        {state.error && <p className="error">{state.error}</p>}
        {state.loading && <span className="spinner" aria-label="Loading" />}

        {tree && user && (
          <div className="browse">
            <nav aria-label={`${user}'s folders`}>
              <ul className="tree">
                {[...tree.children.values()].map((n) => (
                  <TreeNode key={n.path} node={n} selected={selected} onSelect={setSelected} depth={0} />
                ))}
              </ul>
            </nav>
            <div className="folder-pane">{dir ? <Folder user={user} dir={dir} /> : <p className="page-sub">Pick a folder to see its files.</p>}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  selected,
  onSelect,
  depth,
}: {
  node: Node;
  selected?: string;
  onSelect: (p: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasKids = node.children.size > 0;
  return (
    <li>
      <button
        className="tree-node"
        aria-current={selected === node.path}
        aria-expanded={hasKids ? open : undefined}
        onClick={() => {
          if (hasKids) setOpen((o) => !o);
          if (node.dir) onSelect(node.path);
        }}
      >
        {hasKids ? <span className={`chev ${open ? 'open' : ''}`}><Icon name="chevron" size={16} /></span> : <Icon name="folder" size={14} />}
        <span className="label">{node.name}</span>
        <span className="n">{node.total}</span>
      </button>
      {hasKids && open && (
        <ul>
          {[...node.children.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <TreeNode key={c.path} node={c} selected={selected} onSelect={onSelect} depth={depth + 1} />
            ))}
        </ul>
      )}
    </li>
  );
}

function Folder({ user, dir }: { user: string; dir: BrowseDirectory }) {
  const enqueue = useStore((s) => s.enqueue);
  const queuedKeys = useStore((s) => s.queuedKeys);
  const name = dir.name.split(/[\\/]/).pop() ?? dir.name;
  const full = dir.files.map((f) => ({ filename: `${dir.name}\\${f.filename}`, size: f.size }));
  const allQueued = full.every((f) => queuedKeys.has(`${user}\u0000${f.filename}`));
  const size = dir.files.reduce((s, f) => s + f.size, 0);

  return (
    <div>
      <h2>{name}</h2>
      <div className="meta" style={{ marginBottom: 14 }}>
        <span>{dir.fileCount} files</span>
        <span>{bytes(size)}</span>
        <button className={`btn small ${allQueued ? 'done' : ''}`} disabled={allQueued} onClick={() => enqueue(user, full, name)}>
          <Icon name={allQueued ? 'check' : 'download'} size={16} /> {allQueued ? 'Queued' : 'Download folder'}
        </button>
      </div>
      <ol className="tracks">
        {dir.files.map((f, i) => {
          const fullName = `${dir.name}\\${f.filename}`;
          const queued = queuedKeys.has(`${user}\u0000${fullName}`);
          return (
            <li key={f.filename} className={`track ${isAudio(f) ? `t-${tierOf(f)}` : ''}`}>
              <span className="no">{i + 1}</span>
              <span className="name" title={f.filename}>{f.filename}</span>
              <span className="dim">{f.length ? duration(f.length) : ''}</span>
              <span className="dim size">{isAudio(f) ? `${formatLabel(f)}, ` : ''}{bytes(f.size)}</span>
              <button
                className="icon-btn"
                disabled={queued}
                aria-label={queued ? 'Queued' : `Download ${f.filename}`}
                onClick={() => enqueue(user, [{ filename: fullName, size: f.size }], f.filename)}
              >
                <Icon name={queued ? 'check' : 'download'} size={16} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What the person says about themselves, and whether you'd get a slot now. */
function Profile({ user }: { user: string }) {
  const backend = useStore((s) => s.backend);
  const [info, setInfo] = useState<UserInfo>();
  const [status, setStatus] = useState<UserStatus>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!backend) return;
    backend.userStatus(user).then(setStatus).catch(() => undefined);
    backend.userInfo(user).then(setInfo).catch(() => setFailed(true));
  }, [backend, user]);

  const presence = status?.presence ?? 'Online';
  const picture = info?.picture ? `data:image/*;base64,${info.picture}` : undefined;

  return (
    <section className="profile" aria-label={`About ${user}`}>
      {picture && <img className="avatar" src={picture} alt="" />}
      <div className="profile-body">
        <div className="profile-facts">
          {status && (
            <span className="fact">
              <span className={`presence ${presence.toLowerCase()}`} aria-hidden /> {presence}
            </span>
          )}
          {status?.isPrivileged && <span className="fact">Privileged, jumps queues</span>}
          {info && (
            <span className="fact">
              {info.hasFreeUploadSlot ? 'Free slot now' : `${info.queueLength ?? 0} waiting in queue`}
            </span>
          )}
          {info?.uploadSlots !== undefined && <span className="fact dim">{info.uploadSlots} upload slots</span>}
        </div>
        {info?.description ? (
          <p className="bio">{info.description}</p>
        ) : (
          <p className="bio dim">{failed ? 'Couldn’t load their profile.' : info ? 'No description.' : 'Loading profile…'}</p>
        )}
      </div>
    </section>
  );
}

function PersonActions({ user, onMessage }: { user: string; onMessage: () => void }) {
  const backend = useStore((s) => s.backend);
  const isBuddy = usePrefs((s) => s.buddies.some((b) => b.username === user));
  const isIgnored = usePrefs((s) => s.ignored.includes(user));
  const { addBuddy, removeBuddy, ignore, unignore } = usePrefs.getState();
  const [blocked, setBlockedState] = useState<boolean>();

  useEffect(() => {
    backend
      ?.settings()
      .then((s) => setBlockedState(s.blocked.includes(user)))
      .catch(() => undefined);
  }, [backend, user]);

  return (
    <div className="head-actions">
      <button className="btn small" onClick={onMessage}>
        <Icon name="chat" size={16} /> Message
      </button>
      <button className="btn quiet small" aria-pressed={isBuddy} onClick={() => (isBuddy ? removeBuddy(user) : addBuddy(user))}>
        <Icon name={isBuddy ? 'check' : 'person'} size={16} /> {isBuddy ? 'In your people' : 'Add to people'}
      </button>
      <button className="btn quiet small" aria-pressed={isIgnored} onClick={() => (isIgnored ? unignore(user) : ignore(user))}>
        {isIgnored ? 'Stop ignoring' : 'Ignore'}
      </button>
      {blocked !== undefined && (
        <button
          className="btn quiet small"
          aria-pressed={blocked}
          onClick={async () => {
            if (await setBlocked(user, !blocked)) setBlockedState(!blocked);
          }}
        >
          {blocked ? 'Share with them again' : 'Don’t share with them'}
        </button>
      )}
    </div>
  );
}
