/**
 * The changelog entries up to a given version. The next version's entry is written as changes land, before it's
 * released; a build copied in early (or a test build) shouldn't list it as if it were out.
 */
export function shownChanges<T extends { version: string }>(version: string, changes: T[]): T[] {
  const num = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const mine = num(version);
  if (!mine.length) return changes;
  const notNewer = (v: string) => {
    // "0.1–0.5" counts as its last version; "0.8" as 0.8.0.
    const n = num(v.split(/[–-]/).pop()!);
    for (let i = 0; i < 3; i++) if ((n[i] ?? 0) !== (mine[i] ?? 0)) return (n[i] ?? 0) < (mine[i] ?? 0);
    return true;
  };
  return changes.filter((c) => notNewer(c.version));
}
