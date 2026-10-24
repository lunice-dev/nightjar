import { useEffect } from 'react';
import { create } from 'zustand';
import { useStore } from '../store';

/** Who may not download from you, shared by every screen that shows a Block button. */
const useBlockedStore = create<{ list?: string[]; editable: boolean }>(() => ({ editable: true }));

async function loadBlocked() {
  const { backend } = useStore.getState();
  if (!backend) return;
  try {
    const s = await backend.settings();
    useBlockedStore.setState({ list: s.blocked, editable: s.editable });
  } catch {
    useBlockedStore.setState((s) => ({ list: s.list ?? [] }));
  }
}

/** The blocked list (undefined while loading), loaded the first time a screen asks for it. */
export function useBlocked() {
  const backend = useStore((s) => s.backend);
  const list = useBlockedStore((s) => s.list);
  const editable = useBlockedStore((s) => s.editable);
  useEffect(() => {
    if (backend && useBlockedStore.getState().list === undefined) loadBlocked();
  }, [backend]);
  return { list, editable, reload: loadBlocked };
}

/**
 * Adds or removes someone from slskd's list of people who may not download
 * from you. Returns false (after telling the person why) when it can't.
 */
export async function setBlocked(username: string, blocked: boolean, quiet = false): Promise<boolean> {
  const { backend, toast } = useStore.getState();
  if (!backend) return false;
  try {
    const s = await backend.settings();
    if (!s.editable) {
      toast('slskd is set to refuse changes from the UI. Turn on remote_configuration in its config file.', 'error');
      return false;
    }
    const has = s.blocked.includes(username);
    if (has !== blocked) {
      const next = blocked ? [...s.blocked, username] : s.blocked.filter((u) => u !== username);
      await backend.saveSettings({ blocked: next });
      useBlockedStore.setState({ list: next });
      if (!quiet) toast(blocked ? `${username} can no longer download from you` : `${username} can download from you again`);
    }
    return true;
  } catch (e) {
    toast(`Couldn't update your sharing list: ${(e as Error).message}`, 'error');
    return false;
  }
}

/**
 * Blocks someone and stops everything they're downloading from you or waiting for.
 * Returns how many uploads were stopped, or null when blocking failed.
 */
export async function blockAndStop(username: string): Promise<number | null> {
  const { backend, uploads, refreshTransfers, toast } = useStore.getState();
  if (!(await setBlocked(username, true, true))) return null;
  const files = uploads
    .filter((u) => u.username === username)
    .flatMap((u) => u.directories.flatMap((d) => d.files))
    .filter((f) => !f.state.startsWith('Completed'));
  await Promise.all(files.map((f) => backend?.cancel('upload', f.username, f.id, false).catch(() => undefined)));
  refreshTransfers('upload');
  toast(files.length ? `Blocked ${username} and stopped ${files.length} ${files.length === 1 ? 'upload' : 'uploads'}` : `Blocked ${username}`);
  return files.length;
}
