import { parseDocument } from 'yaml';

const DEFAULT_GROUP = ['transfers', 'groups', 'default'];
const FRIENDS = ['transfers', 'groups', 'user_defined', 'friends'];

/**
 * The engine's config with each person limited to one file at a time (the default group, and the friends group when
 * there is one), so "uploads at once" counts people. Anything already set is left as it is. Null when nothing needs to change.
 */
export function oneFilePerPersonYaml(text: string): string | null {
  const doc = parseDocument(text.trim() ? text : '{}');
  let changed = false;
  const mine = [...DEFAULT_GROUP, 'upload', 'slots'];
  if (!doc.hasIn(mine)) {
    doc.setIn(mine, 1);
    changed = true;
  }
  const friends = [...FRIENDS, 'upload', 'slots'];
  if (doc.hasIn(FRIENDS) && !doc.hasIn(friends)) {
    doc.setIn(friends, 1);
    changed = true;
  }
  return changed ? doc.toString() : null;
}
