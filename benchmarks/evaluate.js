// Scores checklist extraction and year-over-year comparison against benchmarks/gold.
// Usage: node benchmarks/evaluate.js [--split development|held_out|all] [--json out.json]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readDocument } from '../src/lib/documents.js';
import { extract as extractV0 } from './baseline-v0.js';
import { diffDocuments } from './baseline-v0.js';
import { extract as extractV1 } from '../src/tools.js';
import { compareNotices } from '../src/compare.js';

const TOP_K = 15;
const root = fileURLToPath(new URL('../data/raw/', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('sources.json', import.meta.url), 'utf8'));
const argv = process.argv.slice(2);
const split = argv.includes('--split') ? argv[argv.indexOf('--split') + 1] : 'all';
const pairs = manifest.pairs.filter(p => split === 'all' || p.split === split);

const scanNo = l => Number(/scan(\d+)$/.exec(l)?.[1]);
const inScope = (scope, locators) => !scope?.length || locators.some(l => !scope.some(([a, b]) => scanNo(l) >= a && scanNo(l) <= b));
const squash = s => String(s).replace(/\([^)]*\)/g, '').replace(/[\s·ㆍ‧\-]/g, '');
function bigrams(s) { const r = new Set(); for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2)); return r; }
function similar(a, b) {
  const x = squash(a), y = squash(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const A = bigrams(x), B = bigrams(y);
  return 2 * [...A].filter(g => B.has(g)).length / (A.size + B.size || 1) >= 0.5;
}
const locs = item => item.evidence?.locators ?? [item.evidence.locator];

// Location must overlap and names must agree, because one line can list several documents.
function scoreDocuments(gold, predicted, scope) {
  predicted = predicted.filter(p => inScope(scope, locs(p)));
  const used = new Set(); let tp = 0, kindOk = 0; const missed = [];
  for (const g of gold) {
    const i = predicted.findIndex((p, k) => !used.has(k) && locs(p).some(l => g.locators.includes(l)) && similar(p.name, g.name));
    if (i < 0) { missed.push(g.name); continue; }
    used.add(i); tp++;
    const kind = predicted[i].kind === 'conditional' || predicted[i].kind === 'optional' ? 'conditional' : 'required';
    if (kind === g.kind) kindOk++;
  }
  const extras = predicted.filter((_, k) => !used.has(k)).map(p => p.name);
  return { gold: gold.length, predicted: predicted.length, tp, kindOk, missed, extras };
}
function scorePeriod(gold, deadlines) {
  if (!gold) return { hit: null, candidates: deadlines.length };
  return { hit: deadlines.some(d => locs(d).some(l => gold.locators.includes(l))), candidates: deadlines.length };
}
function scoreChanges(gold, changes, scopeAfter) {
  const touches = (c, g) => (c.before ? locsOf(c.before) : []).some(l => g.before_locators.includes(l)) || (c.after ? locsOf(c.after) : []).some(l => g.after_locators.includes(l));
  const locsOf = e => e.locators ?? [e.locator];
  const relevant = changes.filter(c => !c.after || inScope(scopeAfter, locsOf(c.after)));
  const result = {};
  for (const level of ['high', 'medium', 'low']) {
    const items = gold.filter(g => g.importance === level);
    result[level] = { gold: items.length, found: items.filter(g => relevant.some(c => touches(c, g))).length, foundTopK: items.filter(g => relevant.slice(0, TOP_K).some(c => touches(c, g))).length };
  }
  result.items = relevant.length;
  return result;
}

const systems = {
  baseline: async (before, after) => {
    // v0 system: rhwp text only (no table structure), heading rules, raw line diff.
    const [b, a] = [{ ...before, tables: [] }, { ...after, tables: [] }];
    return { before: extractV0(b), after: extractV0(a), changes: diffDocuments(b, a).changes };
  },
  improved: async (before, after) => {
    const result = compareNotices(before, after);
    return { before: extractV1(before), after: extractV1(after), changes: result.changes };
  }
};

const report = [];
for (const pair of pairs) {
  const gold = JSON.parse(await readFile(new URL(`gold/${pair.id}.json`, import.meta.url), 'utf8'));
  const source = id => manifest.documents.find(d => d.id === id).file;
  const [before, after] = await Promise.all([readDocument(root, source(pair.before), { parser: 'rhwp' }), readDocument(root, source(pair.after), { parser: 'rhwp' })]);
  const scope = gold.out_of_scope ?? {};
  for (const [name, run] of Object.entries(systems)) {
    const out = await run(before, after);
    report.push({
      pair: pair.id, split: pair.split, system: name,
      documents: [pair.before, pair.after].map((id, i) => ({ id, ...scoreDocuments(gold.documents[id].submission_documents, (i ? out.after : out.before).requirements, scope[id]) })),
      period: [pair.before, pair.after].map((id, i) => ({ id, ...scorePeriod(gold.documents[id].application_period, (i ? out.after : out.before).deadlines) })),
      changes: scoreChanges(gold.changes, out.changes, scope[pair.after])
    });
  }
}

const pct = (n, d) => d ? `${Math.round(100 * n / d)}%` : '-';
for (const system of Object.keys(systems)) {
  const rows = report.filter(r => r.system === system);
  const docs = rows.flatMap(r => r.documents), periods = rows.flatMap(r => r.period).filter(p => p.hit !== null);
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
  const ch = lvl => [sum(rows, r => r.changes[lvl].found), sum(rows, r => r.changes[lvl].foundTopK), sum(rows, r => r.changes[lvl].gold)];
  const [hf, hk, hg] = ch('high'), [mf, , mg] = ch('medium');
  console.log(`\n## ${system} (${split}, ${rows.length} pairs)`);
  console.log(`서류 재현율 ${pct(sum(docs, d => d.tp), sum(docs, d => d.gold))} (${sum(docs, d => d.tp)}/${sum(docs, d => d.gold)}), 정밀도 ${pct(sum(docs, d => d.tp), sum(docs, d => d.predicted))} (${sum(docs, d => d.tp)}/${sum(docs, d => d.predicted)}), 필수/조건부 일치 ${pct(sum(docs, d => d.kindOk), sum(docs, d => d.tp))}`);
  console.log(`신청기간 적중 ${sum(periods, p => p.hit)}/${periods.length}, 후보 수 평균 ${(sum(periods, p => p.candidates) / (periods.length || 1)).toFixed(1)}`);
  console.log(`변경 재현율 high ${hf}/${hg}, medium ${mf}/${mg}; 상위 ${TOP_K}개 안의 high ${hk}/${hg}; 검토할 변경 항목 ${sum(rows, r => r.changes.items)}개`);
  for (const r of rows) console.log(`  ${r.pair}: 서류 ${r.documents.map(d => `${d.tp}/${d.gold}(+${d.predicted - d.tp})`).join(' ')} · 기간 ${r.period.map(p => p.hit ? 'O' : 'X').join('')} · high ${r.changes.high.found}/${r.changes.high.gold} top${TOP_K} ${r.changes.high.foundTopK} · 항목 ${r.changes.items}`);
}
if (argv.includes('--verbose')) for (const r of report) for (const d of r.documents) console.log(r.system, d.id, 'missed', d.missed, 'extras', d.extras);
if (argv.includes('--json')) await writeFile(argv[argv.indexOf('--json') + 1], JSON.stringify(report, null, 2));
