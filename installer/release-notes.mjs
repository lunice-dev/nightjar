// Prints a version's release notes from the changelog in About (CHANGES in src/screens/AboutScreen.tsx),
// one "- " line per item. Reads the items' quoted strings up to the list's closing bracket, so an entry
// written on one line or across several reads the same.
//   node installer/release-notes.mjs 0.8.2
import { readFileSync } from 'node:fs';

// "0.8.0" may be written "0.8" in the changelog, or in full; "0.8.10" stays itself.
const full = process.argv[2] ?? '';
const short = full.replace(/^(\d+\.\d+)\.0$/, '$1');
const source = readFileSync(new URL('../src/screens/AboutScreen.tsx', import.meta.url), 'utf8');
let at = source.indexOf(`version: '${short}'`);
if (at < 0) at = source.indexOf(`version: '${full}'`);
const open = at < 0 ? -1 : source.indexOf('items: [', at);
const items = [];
if (open >= 0) {
  for (let i = open + 'items: ['.length; i < source.length; i++) {
    const c = source[i];
    if (c === ']') break;
    if (c !== "'") continue;
    let text = '';
    for (i++; i < source.length && source[i] !== "'"; i++) {
      if (source[i] === '\\') i++;
      text += source[i];
    }
    items.push(text);
  }
}
console.log(items.map((line) => `- ${line}`).join('\n'));
