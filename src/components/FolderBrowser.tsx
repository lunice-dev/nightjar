import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Icon } from './Icon';

/**
 * Choosing a folder on the computer from a phone: Windows' folder dialog would open on
 * the computer, so the page lists the computer's folders itself (through the helper).
 */

interface Asking {
  start?: string;
  resolve: (path: string | null) => void;
}

const useAsk = create<{ asking: Asking | null }>(() => ({ asking: null }));

/** Opens the folder browser; resolves to the chosen folder, or null when cancelled. */
export function pickFolderHere(start?: string): Promise<string | null> {
  return new Promise((resolve) => {
    useAsk.getState().asking?.resolve(null);
    useAsk.setState({ asking: { start, resolve } });
  });
}

interface Listing {
  path: string | null;
  parent: string | null;
  folders: { name: string; path: string }[];
  error?: string;
}

/** Rendered once by the app; shows itself while a folder is being chosen. */
export function FolderBrowserHost({ helper }: { helper: string }) {
  const asking = useAsk((s) => s.asking);
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState<string>();

  const open = async (path: string | null) => {
    setError(undefined);
    try {
      const res = await fetch(`${helper}/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`The computer answered ${res.status}.`);
      const l = (await res.json()) as Listing;
      setListing(l);
      if (l.error) setError(l.error);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (asking) open(asking.start ?? null);
    else setListing(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);

  if (!asking) return null;
  const done = (path: string | null) => {
    asking.resolve(path);
    useAsk.setState({ asking: null });
  };
  const here = listing?.path ?? null;

  return (
    <div className="modal-backdrop" onClick={() => done(null)}>
      <div className="modal folder-browser" role="dialog" aria-label="Choose a folder on your computer" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && done(null)}>
        <h2>Choose a folder</h2>
        <p className="hint-text">These are the folders on the computer Nightjar runs on.</p>
        <div className="fb-where">
          {here ? (
            <>
              <button className="btn quiet small" onClick={() => open(listing?.parent ?? null)} aria-label="Up one folder">
                <Icon name="back" size={15} /> Up
              </button>
              <code>{here}</code>
            </>
          ) : (
            <strong>Places on your computer</strong>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <ul className="fb-list">
          {listing?.folders.map((f) => (
            <li key={f.path}>
              <button onClick={() => open(f.path)}>
                <Icon name="folder" size={16} /> {f.name}
              </button>
            </li>
          ))}
          {listing && listing.folders.length === 0 && !error && <li className="dim">No folders inside.</li>}
        </ul>
        <div className="save-row">
          <button className="btn" disabled={!here} onClick={() => done(here)}>
            Use this folder
          </button>
          <button className="btn quiet" onClick={() => done(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
