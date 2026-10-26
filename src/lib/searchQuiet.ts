/** Searches run at least this long: the first answers take a few seconds to arrive. */
const MIN_RUN_MS = 6000;
/** No new answers for this long: the people who have it have answered. */
const QUIET_MS = 3000;
/** Nobody at all after this long: nobody will (or the server blocks the name). */
const NOBODY_MS = 12_000;
/** A popular name keeps trickling in for a minute; past this point the late answers rarely add anything. */
const TRICKLE_AFTER_MS = 8000;
/** Never longer than this: results only show once a search ends. */
const MAX_RUN_MS = 20_000;

/**
 * Whether a running search can end now and show its results. slskd hands over answers only when a search ends, so
 * every second it runs is a second of waiting. `ranFor` is how long it has been running (not counting time waiting
 * its turn), `quietFor` how long since the count of answers last changed, `answers` that count, and `lastFew` how
 * many of them came in the last three seconds.
 */
export function quietEnough(ranFor: number, quietFor: number, answers: number, lastFew = 0) {
  if (answers === 0) return ranFor >= NOBODY_MS;
  if (ranFor >= MAX_RUN_MS) return true;
  if (ranFor >= MIN_RUN_MS && quietFor >= QUIET_MS) return true;
  // Most answers come in the first seconds; once only a trickle is left, the results are as good as they'll get.
  return ranFor >= TRICKLE_AFTER_MS && answers >= 100 && lastFew < Math.max(5, answers * 0.03);
}
