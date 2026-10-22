import { useStore } from '../store';

/**
 * Adds or removes someone from slskd's list of people who may not download
 * from you. Returns false (after telling the person why) when it can't.
 */
export async function setBlocked(username: string, blocked: boolean): Promise<boolean> {
  const { backend, toast } = useStore.getState();
  if (!backend) return false;
  try {
    const s = await backend.settings();
    if (!s.editable) {
      toast('slskd is set to refuse changes from the UI. Turn on remote_configuration in its config file.', 'error');
      return false;
    }
    const has = s.blocked.includes(username);
    if (has === blocked) return true;
    await backend.saveSettings({ blocked: blocked ? [...s.blocked, username] : s.blocked.filter((u) => u !== username) });
    toast(blocked ? `${username} can no longer download from you` : `${username} can download from you again`);
    return true;
  } catch (e) {
    toast(`Couldn't update your sharing list: ${(e as Error).message}`, 'error');
    return false;
  }
}
