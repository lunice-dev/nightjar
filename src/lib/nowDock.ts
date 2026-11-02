import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Which kind of screen is showing: the dock remembers whether it was open separately for each. */
export type DockGroup = 'home' | 'library' | 'other';
export const dockGroupOf = (route: string): DockGroup => (route === 'search' ? 'home' : route === 'library' ? 'library' : 'other');

/**
 * The Now panel docked at the right of the window (on a computer): what's playing and the whole tracklist. In the
 * Library it also has an Album tab for the album picked there. Open or closed is remembered for each kind of screen.
 */
export const useNowDock = create<{
  open: Record<DockGroup, boolean>;
  /** The album picked in the Library, shown in the Album tab. */
  albumDir: string | null;
  tab: 'now' | 'album';
  toggle(group: DockGroup): void;
  setOpen(group: DockGroup, on: boolean): void;
  /** Picks an album: opens its tab (picking it again closes the tab). */
  pickAlbum(dir: string): void;
  closeAlbum(): void;
  showNow(): void;
  setTab(tab: 'now' | 'album'): void;
}>()(
  persist(
    (set, get) => ({
      open: { home: true, library: true, other: false },
      albumDir: null,
      tab: 'now',
      toggle: (group) => set((s) => ({ open: { ...s.open, [group]: !s.open[group] } })),
      setOpen: (group, on) => set((s) => ({ open: { ...s.open, [group]: on } })),
      pickAlbum: (dir) => {
        if (get().albumDir === dir) return get().closeAlbum();
        set((s) => ({ albumDir: dir, tab: 'album', open: { ...s.open, library: true } }));
      },
      closeAlbum: () => set({ albumDir: null, tab: 'now' }),
      showNow: () => set({ tab: 'now' }),
      setTab: (tab) => set({ tab }),
    }),
    {
      name: 'nightjar-now-dock',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ open: s.open }),
    },
  ),
);
