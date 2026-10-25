import { describe, expect, it } from 'vitest';
import { checkNote, verdictText } from './check';

describe('quality verdicts as shown', () => {
  it('calls an unconfirmable hi-res check "Probably hi-res", also in checks saved before', () => {
    expect(verdictText('Hi-res')).toBe('Probably hi-res');
    expect(checkNote({ verdict: 'Hi-res', note: 'Every track looks genuine.' })).toMatch(/too little high sound/);
  });
  it('leaves every other verdict as it is', () => {
    for (const v of ['Verified hi-res', 'True hi-res', 'Probably hi-res', 'Upsampled', 'Verified lossless']) expect(verdictText(v)).toBe(v);
    expect(checkNote({ verdict: 'Verified hi-res', note: 'Every track looks genuine.' })).toBe('Every track looks genuine.');
  });
});
