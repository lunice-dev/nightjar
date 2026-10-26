import { describe, expect, it } from 'vitest';
import { relocated, relocatedDir } from './useLocal';

describe('downloads put in the library', () => {
  const moves = { 'c:\\dl\\pilot talk ii': 'C:\\Music\\FLAC\\Curren$y\\2010 - Pilot Talk II', 'c:\\dl\\undone': 'C:\\dl\\Undone' };
  it('finds a file, and a disc folder, in the album’s new place', () => {
    expect(relocated('C:\\dl\\Pilot Talk II\\01 - Airborne Aquarium.flac', moves)).toBe('C:\\Music\\FLAC\\Curren$y\\2010 - Pilot Talk II\\01 - Airborne Aquarium.flac');
    expect(relocated('C:\\dl\\Pilot Talk II\\CD2\\01.flac', moves)).toBe('C:\\Music\\FLAC\\Curren$y\\2010 - Pilot Talk II\\CD2\\01.flac');
  });
  it('follows a remembered album folder too', () => {
    expect(relocatedDir('C:\\dl\\Pilot Talk II', moves)).toBe('C:\\Music\\FLAC\\Curren$y\\2010 - Pilot Talk II');
    expect(relocatedDir('C:\\dl\\Other', moves)).toBe('C:\\dl\\Other');
  });
  it('leaves files that never moved, or were moved back', () => {
    expect(relocated('C:\\dl\\Other\\01.flac', moves)).toBeUndefined();
    expect(relocated('C:\\dl\\Undone\\01.flac', moves)).toBeUndefined();
  });
});
