/** Searches run at least this long: the first answers take a few seconds to arrive. */
const MIN_RUN_MS = 6000;
/** No new answers for this long: the people who have it have answered. */
const QUIET_MS = 4000;
/** Nobody at all after this long: nobody will (or the server blocks the name). */
const NOBODY_MS = 12_000;

/**
 * Whether a running search can end now and show its results: it has run a while and answers stopped coming.
 * `ranFor` is how long it has been running (not counting time waiting its turn), `quietFor` how long since the
 * count of answers last changed, `answers` that count.
 */
export function quietEnough(ranFor: number, quietFor: number, answers: number) {
  if (answers === 0) return ranFor >= NOBODY_MS;
  return ranFor >= MIN_RUN_MS && quietFor >= QUIET_MS;
}
