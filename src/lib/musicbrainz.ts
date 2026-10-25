/**
 * MusicBrainz asks for at most one request a second from each user. Every lookup Nightjar makes there (covers,
 * album track lists) waits its turn here. Urgent ones (you just pressed Download) go to the front of the line,
 * even when the same lookup was already waiting further back.
 */
type Job = { url: string; done: Promise<unknown>; resolve: (v: unknown) => void };
const line: Job[] = [];
const waiting = new Map<string, Job>();
let running = false;

async function run() {
  if (running) return;
  running = true;
  while (line.length) {
    const job = line.shift()!;
    waiting.delete(job.url);
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(8000) });
      // Busy (503) or anything else odd: no answer this time; callers try again another time.
      job.resolve(res.ok ? await res.json() : null);
    } catch {
      job.resolve(null);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  running = false;
}

/** A MusicBrainz web-service answer (JSON), or null when it couldn't be had. */
export function mbFetch<T>(url: string, urgent = false): Promise<T | null> {
  const had = waiting.get(url);
  if (had) {
    if (urgent) {
      line.splice(line.indexOf(had), 1);
      line.unshift(had);
    }
    return had.done as Promise<T | null>;
  }
  let resolve!: (v: unknown) => void;
  const done = new Promise<unknown>((r) => (resolve = r));
  const job = { url, done, resolve };
  waiting.set(url, job);
  if (urgent) line.unshift(job);
  else line.push(job);
  void run();
  return done as Promise<T | null>;
}
