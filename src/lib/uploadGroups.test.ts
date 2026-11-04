import { describe, expect, it } from 'vitest';
import { oneFilePerPersonYaml } from './uploadGroups';

describe('one file at a time per person', () => {
  it('adds the limit and keeps comments and other settings', () => {
    const out = oneFilePerPersonYaml('# mine\ntransfers:\n  upload:\n    slots: 4 # people\n');
    expect(out).toContain('# mine');
    expect(out).toContain('slots: 4 # people');
    expect(out).toMatch(/groups:\s+default:\s+upload:\s+slots: 1/);
  });
  it('limits the friends group too when there is one', () => {
    const out = oneFilePerPersonYaml('transfers:\n  groups:\n    user_defined:\n      friends:\n        upload:\n          priority: 1\n        members: []\n');
    expect(out?.match(/slots: 1/g)).toHaveLength(2);
  });
  it('leaves a limit someone already chose', () => {
    expect(oneFilePerPersonYaml('transfers:\n  groups:\n    default:\n      upload:\n        slots: 3\n')).toBeNull();
  });
  it('works on an empty config', () => {
    expect(oneFilePerPersonYaml('')).toContain('slots: 1');
  });
});
