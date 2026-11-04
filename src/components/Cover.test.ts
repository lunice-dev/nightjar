import { describe, expect, it } from 'vitest';
import { coverDirs } from './Cover';

describe('where an album’s picture can be', () => {
  it('is the album folder above a disc folder as well', () => {
    expect(coverDirs('C:\\Music\\Band\\1991 - Album\\CD 01')).toEqual(['C:\\Music\\Band\\1991 - Album\\CD 01', 'C:\\Music\\Band\\1991 - Album']);
  });
  it('is only the folder itself for an ordinary album folder', () => {
    expect(coverDirs('C:\\Music\\Band\\1991 - Album')).toEqual(['C:\\Music\\Band\\1991 - Album']);
    expect(coverDirs(undefined)).toEqual([]);
  });
});
