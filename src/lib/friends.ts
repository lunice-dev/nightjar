import { useEffect } from 'react';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { useFilesAvailable } from './files';

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * With "friends first" on, the engine's friends group follows the People list: add someone there and
 * they get your uploads before everyone else. Only this computer does it (a phone keeps its own list).
 */
export function useFriendsSync() {
  const backend = useStore((s) => s.backend);
  const onThisPc = useFilesAvailable();
  const names = usePrefs((s) => s.buddies.map((b) => b.username).sort().join('\n'));
  useEffect(() => {
    if (!backend || !onThisPc) return;
    const t = setTimeout(async () => {
      const s = await backend.settings().catch(() => null);
      if (!s || !s.editable || !s.friendsFirst) return;
      const want = names ? names.split('\n') : [];
      if (sameList(s.friends, want)) return;
      await backend.saveSettings({ friends: want }).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(t);
  }, [backend, onThisPc, names]);
}

/** Turns "friends first" on or off, filling the group with the People list. */
export async function setFriendsFirst(on: boolean) {
  const { backend, toast } = useStore.getState();
  if (!backend) return false;
  try {
    const friends = usePrefs.getState().buddies.map((b) => b.username);
    await backend.saveSettings(on ? { friendsFirst: true, friends } : { friendsFirst: false });
    return true;
  } catch (e) {
    toast(`Couldn't change that: ${(e as Error).message}`, 'error');
    return false;
  }
}
