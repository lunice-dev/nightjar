import { dirOf } from './covers';
import { basename, isDiscFolder } from './quality';

/** The folders that may hold an album's picture: a track's disc folder (CD 1) keeps it in the album folder above. */
export const coverDirs = (dir?: string): string[] => (!dir ? [] : isDiscFolder(basename(dir)) ? [dir, dirOf(dir)] : [dir]);
