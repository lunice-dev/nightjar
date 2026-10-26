import type { Transfer } from '../api/types';

/**
 * Why an upload (a file someone downloads from you) didn't go through, in plain words, and whose side it most likely
 * was. Most are on their side and harmless: their client usually asks again. `ours` marks a problem on this computer,
 * the only kind shown in red. `detail` is the engine's own message, for anyone who wants it (and for reports).
 */
export interface UploadReason {
  text: string;
  ours: boolean;
  detail?: string;
}

export function uploadReason(t: Pick<Transfer, 'state' | 'exception'>): UploadReason | null {
  const s = t.state;
  if (!s.startsWith('Completed') || s === 'Completed, Succeeded') return null;
  const detail = t.exception?.trim() || undefined;
  const e = (detail ?? '').toLowerCase();
  const say = (text: string, ours = false) => ({ text, ours, detail });

  // This computer: the file itself is the problem.
  if (/could not find|not found|no such file|does not exist|access to the path|being used by another process|no space left/.test(e))
    return say('Your computer couldn’t read the file: it was moved, deleted or is in use. It may need sharing again.', true);
  // Stopped here: you pressed Stop, blocked them, or Nightjar was closing.
  if (s === 'Completed, Cancelled' && !/rejected|remote/.test(e)) return say('Stopped on this computer: you stopped it or blocked them, or Nightjar restarted');
  if (e.includes('offline')) return say('They went offline');
  if (s === 'Completed, Rejected' || /rejected|cancelled by the remote|remote.*cancel/.test(e)) return say('They cancelled it');
  if (s === 'Completed, TimedOut' || e.includes('timed out')) return say('They didn’t start it in time');
  if (/remote connection closed|failed to read|connection reset|forcibly closed/.test(e))
    return say('Their side stopped it: they cancelled, closed their app or lost their connection');
  if (/direct or indirect/.test(e))
    return say('Couldn’t connect to them. Usually their port is closed; if this happens with everyone, check yours in Settings');
  return say(detail ? detail.replace(/^.*?:\s*(?=[A-Z])/, '').slice(0, 120) : 'It stopped');
}
