import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LibAlbum, LibBatch, LibMove, LibScan } from '../api/library';
import { useStore } from '../store';

/** What the person changed about one album's place before applying. */
export interface AlbumEdit {
  format?: string;
  artist?: string;
  year?: string;
  noYear?: boolean;
  album?: string;
}

/** Characters Windows doesn't allow in a folder name, as the app replaces them. */
export function safe(name: string) {
  const s = name
    .replace(/\s*:\s+/g, ' - ')
    .replace(/:/g, '-')
    .replace(/[?*<>]/g, '')
    .replace(/"/g, "'")
    .replace(/[/\\|]/g, '-')
    .replace(/[\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  return s || '_';
}

/** Where an album would go, with the person's changes. */
export function placeOf(a: LibAlbum, e: AlbumEdit | undefined, root: string) {
  const format = e?.format ?? a.format;
  const artist = (e?.artist ?? a.artist).trim();
  const album = (e?.album ?? a.album).trim();
  const year = e?.noYear ? null : (e?.year ?? a.year ?? '').trim() || null;
  const needsYear = !e?.noYear && !year;
  const folder = year ? `${year} - ${album}` : album;
  const sep = root.includes('\\') || !root.includes('/') ? '\\' : '/';
  const target = [root.replace(/[\\/]+$/, ''), format, ...(a.group ? [a.group] : []), safe(artist || '…'), safe(folder || '…')].join(sep);
  const yearOk = e?.noYear || /^(1[89]|20)\d{2}$/.test(year ?? '');
  const edited = !!e && Object.keys(e).length > 0;
  // A second copy already sorted as "… (2)" counts as in place.
  const inPlace = !needsYear && (a.dir === target || (!edited && a.status === 'ok') || (a.dir.startsWith(target + ' (') && /\(\d+\)$/.test(a.dir)));
  return { format, artist, album, year, folder, target, needsYear, ready: !!artist && !!album && !!yearOk, inPlace, move: { dir: a.dir, format, artist, folder, group: a.group ?? null } as LibMove };
}

interface Review {
  scan: LibScan | null;
  scanning: { done: number; total: number } | null;
  error: string | null;
  edits: Record<string, AlbumEdit>;
  /** Albums the person unticked. */
  unticked: Record<string, true>;
  /** Copies the person decided to keep all of. */
  keptCopies: string[];
  batches: LibBatch[];
  /** Finds the latest look at the library, or looks again. */
  load(again?: boolean): Promise<void>;
  loadBatches(): Promise<void>;
  edit(dir: string, e: AlbumEdit): void;
  editArtist(dirs: string[], artist: string): void;
  tick(dir: string, on: boolean): void;
  keepCopies(key: string): void;
}

let polling = false;

export const useLibraryReview = create<Review>()(
  persist(
    (set) => ({
      scan: null,
      scanning: null,
      error: null,
      edits: {},
      unticked: {},
      keptCopies: [],
      batches: [],
      async load(again) {
        const backend = useStore.getState().backend;
        if (!backend || polling) return;
        polling = true;
        try {
          if (!again) {
            const last = await backend.library.scanProgress('last');
            if (last?.id && last.finished && last.albums) {
              set({ scan: last, error: null });
              return;
            }
          }
          set({ scanning: { done: 0, total: 0 }, error: null });
          const start = await backend.library.scan();
          if (!start.id) {
            set({ scanning: null, error: start.error ?? 'Couldn’t look through the library.' });
            return;
          }
          for (;;) {
            await new Promise((r) => setTimeout(r, 700));
            const p = await backend.library.scanProgress(start.id);
            if (!p?.id) continue;
            if (!p.finished) {
              set({ scanning: { done: p.done, total: p.total } });
              continue;
            }
            if (p.error) set({ scanning: null, error: p.error });
            else set({ scan: p, scanning: null, error: null });
            return;
          }
        } finally {
          polling = false;
        }
      },
      async loadBatches() {
        const b = await useStore.getState().backend?.library.batches();
        if (b) set({ batches: b });
      },
      edit(dir, e) {
        set((s) => {
          const next = { ...s.edits[dir], ...e };
          for (const k of Object.keys(next) as (keyof AlbumEdit)[]) if (next[k] === undefined) delete next[k];
          return { edits: { ...s.edits, [dir]: next } };
        });
      },
      editArtist(dirs, artist) {
        set((s) => {
          const edits = { ...s.edits };
          for (const d of dirs) edits[d] = { ...edits[d], artist };
          return { edits };
        });
      },
      tick(dir, on) {
        set((s) => {
          const unticked = { ...s.unticked };
          if (on) delete unticked[dir];
          else unticked[dir] = true;
          return { unticked };
        });
      },
      keepCopies(key) {
        set((s) => ({ keptCopies: [...s.keptCopies.filter((k) => k !== key), key] }));
      },
    }),
    {
      name: 'nightjar-library-review',
      storage: createJSONStorage(() => localStorage),
      // The person's decisions stay; the scan itself comes from the app.
      partialize: (s) => ({ edits: s.edits, unticked: s.unticked, keptCopies: s.keptCopies }),
    },
  ),
);
