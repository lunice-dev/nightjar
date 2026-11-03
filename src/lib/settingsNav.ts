import { useStore } from '../store';

/** The sections of the Settings screen. */
export type SettingsTab = 'sharing' | 'transfers' | 'protection' | 'library' | 'account' | 'connection' | 'app';

export const SETTINGS_TABS: { id: SettingsTab; label: string; hint: string; sub: string }[] = [
  { id: 'sharing', label: 'Sharing', hint: 'Folders others can see', sub: 'Choose which folders other people on Soulseek can see and download from.' },
  { id: 'transfers', label: 'Transfers', hint: 'Downloads, speed, who goes first', sub: 'Where your downloads go, how fast things move, and who is served first.' },
  { id: 'protection', label: 'Protection', hint: 'Keep programs away', sub: 'Keep programs and mass downloaders away from your share.' },
  { id: 'library', label: 'Library', hint: 'Your music and playlists', sub: 'Your music folder, how it is organised, and your playlists.' },
  { id: 'account', label: 'Account', hint: 'Sign-in and profile', sub: 'Your Soulseek sign-in and the profile other people see.' },
  { id: 'connection', label: 'Connection', hint: 'Reachability and phone', sub: 'Whether others can reach you, and reaching nightjar from your phone.' },
  { id: 'app', label: 'App', hint: 'Notifications, player, help', sub: 'Notifications, the player, sound output, and getting help.' },
];

const KEY = 'nightjar.settingsTab';
let target: SettingsTab | undefined;

const known = (v: unknown): v is SettingsTab => SETTINGS_TABS.some((t) => t.id === v);

/** Says which section Settings should open on the next time it shows (from a link elsewhere in the app). */
export function setSettingsTarget(tab: SettingsTab) {
  target = tab;
}

/** Opens Settings on a section. */
export function openSettings(tab: SettingsTab) {
  target = tab;
  useStore.getState().go('settings');
}

/** The section a link asked for, once. */
export function takeSettingsTarget(): SettingsTab | undefined {
  const t = target;
  target = undefined;
  return t;
}

/** The section you were on last time. */
export function lastSettingsTab(): SettingsTab {
  try {
    const v = localStorage.getItem(KEY);
    if (known(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return 'sharing';
}

export function rememberSettingsTab(tab: SettingsTab) {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    /* not kept */
  }
}
