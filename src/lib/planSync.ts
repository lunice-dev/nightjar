import { keepPlansElsewhere, usePrefs, type DownloadPlan } from '../prefs';

/**
 * The downloads in progress ("plans") live in one place: the Nightjar app on the computer. Every window and device
 * reads them from there every few seconds (a few bytes when nothing changed, only the changed plans otherwise) and
 * sends its changes straight away, so there is one copy and nothing to merge. An older app without /plans leaves this
 * off and plans travel with the preferences as before.
 */
let base: string | null = null;
let active = false;
let rev = -1;
let busy = false;
let timer: ReturnType<typeof setInterval> | undefined;
let soon: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;
/** Each plan as the computer has it, by id. */
let known = new Map<string, string>();

export type PlanOp = { op: 'put'; plan: DownloadPlan } | { op: 'del'; id: string };

/** What to send so the computer's copy matches this one. */
export function planOps(local: DownloadPlan[], known: Map<string, string>): PlanOp[] {
  const ops: PlanOp[] = [];
  const ids = new Set<string>();
  for (const plan of local) {
    ids.add(plan.id);
    if (known.get(plan.id) !== JSON.stringify(plan)) ops.push({ op: 'put', plan });
  }
  for (const id of known.keys()) if (!ids.has(id)) ops.push({ op: 'del', id });
  return ops;
}

/** The computer's answer: everything (`full`), or the order of all plans (`ids`) and the ones changed since. */
export type Answer = { rev: number; same?: boolean; full?: boolean; ids?: string[]; plans?: DownloadPlan[] };

/** The plans as they are after taking the computer's answer in (null: nothing changed). */
export function applyAnswer(local: DownloadPlan[], answer: Answer): DownloadPlan[] | null {
  if (!answer.plans) return null;
  if (answer.full || !answer.ids) return answer.plans;
  const byId = new Map(local.map((p) => [p.id, p]));
  for (const p of answer.plans) byId.set(p.id, p);
  return answer.ids.map((id) => byId.get(id)).filter((p): p is DownloadPlan => !!p);
}

const ascii = (s: string) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function adopt(answer: Answer) {
  rev = answer.rev;
  const now = usePrefs.getState().plans;
  const next = applyAnswer(now, answer);
  if (!next) return;
  const fromThere = new Set((answer.plans ?? []).map((p) => p.id));
  known = new Map(next.map((p) => [p.id, answer.full || fromThere.has(p.id) || !known.has(p.id) ? JSON.stringify(p) : known.get(p.id)!]));
  if (JSON.stringify(now) !== JSON.stringify(next)) usePrefs.setState({ plans: next });
}

export async function syncPlans() {
  if (!base || busy) return;
  busy = true;
  try {
    const mine = usePrefs.getState().plans;
    const snapshot = JSON.stringify(mine);
    let answer: Answer;
    if (!active) {
      const res = await fetch(`${base}/plans?rev=-1`, { signal: AbortSignal.timeout(8000) });
      if (res.status === 404) {
        base = null; // an older app: plans travel with the preferences
        return;
      }
      if (!res.ok) return;
      answer = (await res.json()) as Answer;
      active = true;
      keepPlansElsewhere(true);
      // The first time: the computer has none yet, so it gets this window's.
      if (!answer.plans?.length && mine.length) {
        known = new Map();
        rev = -1;
        busy = false;
        return syncPlans();
      }
    } else {
      const ops = planOps(mine, known);
      const res = ops.length
        ? await fetch(`${base}/plans`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: ascii(JSON.stringify({ ops, rev })), signal: AbortSignal.timeout(8000) })
        : await fetch(`${base}/plans?rev=${rev}`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      answer = (await res.json()) as Answer;
    }
    // Changed here while waiting: the next round sends that, and takes the computer's copy after.
    if (JSON.stringify(usePrefs.getState().plans) !== snapshot) return;
    adopt(answer);
  } catch {
    // unreachable for now (the computer starting up): try again next time
  } finally {
    busy = false;
  }
}

/** Starts (or, with null, stops) keeping plans on the computer behind this helper address. */
export function planSyncThrough(helper: string | null) {
  if (timer) clearInterval(timer);
  if (soon) clearTimeout(soon);
  unsubscribe?.();
  timer = undefined;
  unsubscribe = undefined;
  base = helper;
  active = false;
  keepPlansElsewhere(false);
  rev = -1;
  known = new Map();
  if (!helper) return;
  timer = setInterval(() => void syncPlans(), 3000);
  void syncPlans();
  // A change made here goes out within a moment, not at the next round.
  unsubscribe = usePrefs.subscribe((s, prev) => {
    if (!active || s.plans === prev.plans) return;
    if (soon) clearTimeout(soon);
    soon = setTimeout(() => void syncPlans(), 400);
  });
}
