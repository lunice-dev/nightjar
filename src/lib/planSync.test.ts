import { describe, expect, it } from 'vitest';
import type { DownloadPlan } from '../prefs';
import { applyAnswer, planOps } from './planSync';

const plan = (id: string, extra = {}) => ({ id, title: id, ...extra }) as unknown as DownloadPlan;

describe('what a window sends to the computer', () => {
  it('sends new and changed plans, and removals', () => {
    const known = new Map([
      ['a', JSON.stringify(plan('a'))],
      ['b', JSON.stringify(plan('b'))],
      ['c', JSON.stringify(plan('c'))],
    ]);
    const ops = planOps([plan('a'), plan('b', { finishedAt: 1 }), plan('d')], known);
    expect(ops.map((o) => (o.op === 'put' ? `put ${o.plan.id}` : `del ${o.id}`)).sort()).toEqual(['del c', 'put b', 'put d']);
  });
  it('sends nothing when the computer already has the same', () => {
    expect(planOps([plan('a')], new Map([['a', JSON.stringify(plan('a'))]]))).toEqual([]);
  });
});

describe('what the computer answers', () => {
  it('replaces everything on a full answer', () => {
    expect(applyAnswer([plan('a')], { rev: 3, full: true, plans: [plan('b')] })?.map((p) => p.id)).toEqual(['b']);
  });
  it('takes only the changed plans, in the computer’s order, and drops removed ones', () => {
    const mine = [plan('a'), plan('b'), plan('c')];
    const out = applyAnswer(mine, { rev: 4, ids: ['d', 'a', 'b'], plans: [plan('b', { finishedAt: 1 }), plan('d')] });
    expect(out?.map((p) => p.id)).toEqual(['d', 'a', 'b']);
    expect(out?.[2]).toMatchObject({ finishedAt: 1 });
    expect(out?.[1]).toBe(mine[0]);
  });
  it('does nothing when nothing changed', () => {
    expect(applyAnswer([plan('a')], { rev: 3, same: true })).toBeNull();
  });
});
