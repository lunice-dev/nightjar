import type { Backend } from '../api/backend';
import type { EnqueueFile, EnqueueOptions } from '../api/types';
import { useStore } from '../store';
import { phaseOf } from './transfers';

/** Files asked for a moment ago, before the engine's list shows them. */
const recent = new Map<string, number>();
const RECENT_MS = 15_000;

const keyOf = (username: string, filename: string) => `${username}\u0000${filename}`;

/**
 * Every request for files goes through here. Asking someone for a file that is already coming (or waiting in their
 * queue) from them, or that was asked for a few seconds ago, would only make a second copy: those are left out.
 * Resolves to the files that were really asked for.
 */
export async function enqueueOnce(backend: Backend, username: string, files: EnqueueFile[], options?: EnqueueOptions): Promise<EnqueueFile[]> {
  const now = Date.now();
  for (const [k, at] of recent) if (now - at > RECENT_MS) recent.delete(k);
  const mine = (useStore.getState().downloads ?? []).find((u) => u.username === username);
  const live = new Set(
    (mine?.directories ?? []).flatMap((d) => d.files).filter((f) => ['active', 'queued'].includes(phaseOf(f.state))).map((f) => keyOf(username, f.filename)),
  );
  const fresh = files.filter((f) => !live.has(keyOf(username, f.filename)) && !recent.has(keyOf(username, f.filename)));
  if (fresh.length === 0) return [];
  fresh.forEach((f) => recent.set(keyOf(username, f.filename), now));
  try {
    await backend.enqueue(username, fresh, options);
  } catch (e) {
    fresh.forEach((f) => recent.delete(keyOf(username, f.filename)));
    throw e;
  }
  return fresh;
}

/** For tests. */
export const forgetRecent = () => recent.clear();
