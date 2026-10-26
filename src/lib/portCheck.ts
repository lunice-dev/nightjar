/**
 * A port test wanted soon: at start, and after a download couldn't reach someone (see usePortWatch in
 * background.ts, which runs it at most every ten minutes).
 */
export const portCheck = { wanted: true };

export function portCheckSoon() {
  portCheck.wanted = true;
}
