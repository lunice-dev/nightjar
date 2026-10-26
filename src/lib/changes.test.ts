import { describe, expect, it } from 'vitest';
import { shownChanges } from './changes';

const changes = [{ version: '0.8.6' }, { version: '0.8.5' }, { version: '0.8' }, { version: '0.7' }, { version: '0.1–0.5' }];
const shown = (v: string) => shownChanges(v, changes).map((c) => c.version);

describe('What’s new in About', () => {
  it('leaves out the next version’s entry before it is released', () => {
    expect(shown('0.8.5')).toEqual(['0.8.5', '0.8', '0.7', '0.1–0.5']);
  });
  it('shows it once this is that version', () => {
    expect(shown('0.8.6')).toEqual(['0.8.6', '0.8.5', '0.8', '0.7', '0.1–0.5']);
  });
  it('treats "0.8" as 0.8.0 and a range as its last version', () => {
    expect(shown('0.8.0')).toEqual(['0.8', '0.7', '0.1–0.5']);
    expect(shown('0.4.0')).toEqual([]);
  });
  it('shows everything when the version is unknown (a test page)', () => {
    expect(shown('')).toHaveLength(5);
  });
});
