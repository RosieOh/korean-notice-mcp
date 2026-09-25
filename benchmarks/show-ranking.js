// Debug view: ranked comparison output next to gold high changes for one pair.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readDocument } from '../src/lib/documents.js';
import { compareNotices } from '../src/compare.js';
const pair = process.argv[2], n = Number(process.argv[3] || 20);
const root = fileURLToPath(new URL('../data/raw/', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('sources.json', import.meta.url), 'utf8'));
const p = manifest.pairs.find(x => x.id === pair), file = id => manifest.documents.find(d => d.id === id).file;
const gold = JSON.parse(await readFile(new URL(`gold/${pair}.json`, import.meta.url), 'utf8'));
const [b, a] = await Promise.all([readDocument(root, file(p.before), { parser: 'rhwp' }), readDocument(root, file(p.after), { parser: 'rhwp' })]);
const r = compareNotices(b, a);
const L = e => e ? (e.locators ?? [e.locator]).join(',') : '-';
for (const c of r.changes.slice(0, n)) console.log(c.rank, c.importance, c.category, c.type, '|', c.summary.slice(0, 110), '|', L(c.before), '->', L(c.after));
for (const g of gold.changes.filter(g => g.importance === 'high')) {
  const hit = r.changes.find(c => (c.before ? (c.before.locators ?? [c.before.locator]) : []).some(l => g.before_locators.includes(l)) || (c.after ? (c.after.locators ?? [c.after.locator]) : []).some(l => g.after_locators.includes(l)));
  console.log('GOLD', hit ? `rank ${hit.rank}` : 'MISS', g.summary.slice(0, 90));
}
console.log('date_only', r.date_only_changes.length);
