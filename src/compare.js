import { evidence } from './lib/documents.js';
import { fail } from './lib/errors.js';
import { extract, heading } from './tools.js';

// The program year is the most frequent 20xx year in the notice.
function programYear(doc) {
  const counts = new Map();
  for (const b of doc.blocks) for (const m of b.text.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  return Number([...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
}
// Replace years relative to the program year so a routine roll-forward compares equal.
function yearless(text, year) {
  if (!year) return text;
  const rel = y => { const d = y - year; return d === 0 ? '{Y}' : `{Y${d > 0 ? '+' : ''}${d}}`; };
  return text
    .replace(/(?<!\d)(20\d\d)(?!\d)/g, (_, y) => Math.abs(y - year) <= 3 ? rel(Number(y)) : y)
    .replace(/[‘’'`](\d\d)(?!\d)/g, (_, y) => Math.abs(2000 + Number(y) - year) <= 3 ? rel(2000 + Number(y)) : _)
    .replace(/(?<![\d.])(\d\d)년/g, (_, y) => Math.abs(2000 + Number(y) - year) <= 3 ? `${rel(2000 + Number(y))}년` : _);
}
const key = s => s.replace(/^[\s○◦□■▸▶►·•\-*◎◇◆→※•-]+/, '').replace(/^(?:\d{1,2}[.)]|[①-⑳]|[㉠-㉻])\s*/, '').replace(/[\s"'“”‘’「」『』｢｣]/g, '');
function bigrams(s) { const r = new Set(); for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2)); return r; }
function dice(a, b) { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return a === b ? 1 : 0; let n = 0; for (const g of A) if (B.has(g)) n++; return 2 * n / (A.size + B.size); }
const clip = (s, n = 120) => s.length > n ? `${s.slice(0, n)}…` : s;

const SECTION_TOPICS = [
  ['eligibility', /제외\s*대상|자격|대상자?$|연\s*령|거\s*주|소득\s*기준/],
  ['selection', /선정|심사|평가|선발\s*방법/],
  ['amount', /지원\s*(?:내용|금액|규모|기준)|지급|선정\s*규모|선발\s*인원|모집\s*인원/]
];
// Tag each block with the notice section it sits in; forms and attachments come last.
function sections(doc, cells) {
  const result = new Map();
  let topic = 'other', attachment = false;
  for (const block of doc.blocks) {
    if (/^[【\[<]\s*(?:붙임|서식|참고)|^서식\s*\d|^(?:붙임|참고)\s*\d/.test(block.text)) attachment = true;
    const h = heading(block.text);
    if (h && h.topic !== 'other') topic = h.topic;
    else if (!cells.has(block.locator) && h?.label) {
      const title = h.label.replace(/^\d{1,2}\.\s*/, '');
      const found = SECTION_TOPICS.find(([, re]) => re.test(title))?.[0];
      if (found) topic = found;
      else if (/^\d{1,2}\.\s*[가-힣]/.test(block.text)) topic = 'other';
    }
    result.set(block.locator, attachment ? 'attachment' : topic);
  }
  return result;
}
const tableOf = doc => { const m = new Map(); for (const t of doc.tables) for (const c of t.rows.flat()) for (const l of c.locators ?? [c.locator]) m.set(l, t.locator); return m; };
const DATE_TOKEN = /[‘’'`]?\d{2,4}\s*\.\s*\d{1,2}\s*\.(?:\s*\d{1,2}\s*\.?)?|\d{1,2}\s*\.\s*\d{1,2}\s*\.|\d{1,2}월\s*\d{1,2}일/g;
const WEIGHT = { eligibility: 4, documents: 4, period: 4, amount: 3, selection: 2, other: 1, attachment: 0 };
function score(topic, beforeText = '', afterText = '') {
  const digits = s => (s.match(/\d[\d,.]*\s*(?:원|만원|천원|세|%|명|가구|개월|년|일|시간|회|점)?/g) ?? []).join('|');
  let s = WEIGHT[topic] ?? 1;
  if (digits(beforeText) !== digits(afterText)) s += /원|세|%|명|가구|개월/.test(beforeText + afterText) ? 2 : 1;
  if (/제외|불가|필수|반드시|취소|환수|중단|지급|한도|이내|이하|이상|미만|초과|만\s*\d+세/.test(beforeText + afterText)) s += 1;
  return s;
}

function lcsDiff(a, b) {
  if (a.length > 3000 || b.length > 3000) fail('DIFF_TOO_LARGE', '비교는 문서당 3,000개 블록까지 지원합니다.');
  const t = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? 1 + t[i + 1][j + 1] : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { ops.push(['same', i++, j++]); }
    else if (j < b.length && (i === a.length || t[i][j + 1] >= t[i + 1][j])) ops.push(['added', null, j++]);
    else ops.push(['removed', i++, null]);
  }
  return ops;
}

function documentChanges(before, after, cb, ca) {
  const name = r => key(r.name.replace(/\([^)]*\)/g, ''));
  const changes = [], used = new Set();
  for (const r of cb.requirements) {
    let best = -1, bestScore = 0.6;
    ca.requirements.forEach((a, k) => { const [x, y] = [name(r), name(a)]; const s = x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)) ? 1 : dice(x, y); if (!used.has(k) && s >= bestScore) { best = k; bestScore = s; } });
    if (best < 0) { changes.push({ type: 'document_removed', category: 'documents', summary: `제출서류 삭제 후보: ${r.name}`, before: r.evidence, after: null, score: 10 }); continue; }
    used.add(best);
    const a = ca.requirements[best];
    if (a.kind !== r.kind) changes.push({ type: 'document_kind_changed', category: 'documents', summary: `${a.name}: ${r.kind === 'required' ? '필수' : '조건부'} → ${a.kind === 'required' ? '필수' : '조건부'}`, before: r.evidence, after: a.evidence, score: 10 });
  }
  ca.requirements.forEach((a, k) => { if (!used.has(k)) changes.push({ type: 'document_added', category: 'documents', summary: `제출서류 추가 후보: ${a.name}`, before: null, after: a.evidence, score: 10 }); });
  const [pb, pa] = [cb.deadlines[0], ca.deadlines[0]];
  if (pb && pa && key(yearless(pb.raw, programYear(before))) !== key(yearless(pa.raw, programYear(after))))
    changes.push({ type: 'period_changed', category: 'period', summary: `신청기간: ${clip(pb.raw, 60)} → ${clip(pa.raw, 60)}`, before: pb.evidence, after: pa.evidence, score: 10 });
  return changes;
}

export function compareNotices(before, after) {
  const cb = extract(before), ca = extract(after);
  const [yb, ya] = [programYear(before), programYear(after)];
  const exact = [before.blocks.map(b => key(b.text)), after.blocks.map(b => key(b.text))];
  const [tb, ta] = [tableOf(before), tableOf(after)];
  const [sb, sa] = [sections(before, tb), sections(after, ta)];
  const ops = lcsDiff(...exact);
  const text = [], dateOnly = [];
  // Pair removed/added runs between unchanged lines into modifications when they are similar.
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === 'same') { k++; continue; }
    const removed = [], added = [];
    for (; k < ops.length && ops[k][0] !== 'same'; k++) ops[k][0] === 'removed' ? removed.push(ops[k][1]) : added.push(ops[k][2]);
    const taken = new Set();
    for (const i of removed) {
      const bt = before.blocks[i].text, bn = key(yearless(bt, yb));
      let best = -1, bestScore = 0.45;
      for (const j of added) { if (taken.has(j)) continue; const s = dice(bn, key(yearless(after.blocks[j].text, ya))); if (s > bestScore) { best = j; bestScore = s; } }
      if (best >= 0) {
        taken.add(best);
        const at = after.blocks[best].text, topic = sa.get(after.blocks[best].locator);
        const item = { type: 'modified', category: topic, summary: `${clip(bt)} → ${clip(at)}`, before: evidence(before, before.blocks[i]), after: evidence(after, after.blocks[best]) };
        const an = key(yearless(at, ya));
        if (bn === an) dateOnly.push(item);
        // Only dates moved (e.g. a cutoff shifted with the new year): keep it, but rank it low.
        else if (bn.replace(DATE_TOKEN, '{date}') === an.replace(DATE_TOKEN, '{date}') && topic !== 'period') text.push({ ...item, type: 'date_changed', score: 1.5 });
        else text.push({ ...item, score: score(topic, bt, at) });
      } else if (key(bt).length >= 4) text.push({ type: 'removed', category: sb.get(before.blocks[i].locator), summary: `삭제: ${clip(bt)}`, before: evidence(before, before.blocks[i]), after: null, score: score(sb.get(before.blocks[i].locator), bt, '') - 0.5 });
    }
    for (const j of added) if (!taken.has(j) && key(after.blocks[j].text).length >= 4) {
      const at = after.blocks[j].text, topic = sa.get(after.blocks[j].locator);
      text.push({ type: 'added', category: topic, summary: `추가: ${clip(at)}`, before: null, after: evidence(after, after.blocks[j]), score: score(topic, '', at) - 0.5 });
    }
  }
  // Several changed cells in one table (e.g. a yearly income table) become one review item.
  const grouped = [], byTable = new Map();
  for (const item of text) {
    const table = (item.after && ta.get(item.after.locator)) ? `a:${ta.get(item.after.locator)}` : item.before && tb.get(item.before.locator) ? `b:${tb.get(item.before.locator)}` : null;
    if (!table) { grouped.push(item); continue; }
    if (!byTable.has(table)) { byTable.set(table, []); grouped.push({ table, items: byTable.get(table) }); }
    byTable.get(table).push(item);
  }
  const merge = (items, side) => {
    const list = items.map(i => i[side]).filter(Boolean);
    return list.length ? { ...list[0], locators: [...new Set(list.flatMap(e => e.locators ?? [e.locator]))] } : null;
  };
  const flat = grouped.map(g => !g.table ? g : g.items.length === 1 ? g.items[0] : {
    type: 'table_changed', category: g.items[0].category,
    summary: `표의 ${g.items.length}개 셀 변경: ${g.items.slice(0, 3).map(i => i.summary.replace(/^(?:추가|삭제): /, '')).join(' / ')}${g.items.length > 3 ? ' …' : ''}`,
    before: merge(g.items, 'before'), after: merge(g.items, 'after'),
    score: Math.max(...g.items.map(i => i.score)) + (g.items.length >= 3 ? 1 : 0)
  });
  // A line already reported as a document or period change is not repeated as a text change.
  const structured = documentChanges(before, after, cb, ca);
  const covered = new Set(structured.flatMap(c => [c.before, c.after]).filter(Boolean).flatMap(e => e.locators ?? [e.locator]));
  const rest = flat.filter(c => !(c.type === 'modified' && covered.has(c.before?.locator) && covered.has(c.after?.locator)));
  const changes = [...structured, ...rest]
    .map((c, order) => ({ ...c, order })).sort((x, y) => y.score - x.score || x.order - y.order)
    .map(({ score: s, order, ...c }, rank) => ({ rank: rank + 1, importance: s >= 6 ? 'high' : s >= 3 ? 'medium' : 'low', ...c }));
  return {
    before: { file: before.file, sha256: before.sha256, program_year: yb },
    after: { file: after.file, sha256: after.sha256, program_year: ya },
    checklist: { requirements: ca.requirements, deadlines: ca.deadlines },
    changes,
    date_only_changes: dateOnly,
    warnings: [...new Set([...cb.warnings, ...ca.warnings])],
    scope: '문구·표 셀 단위 비교와 규칙 기반 중요도 정렬입니다. 연도만 바뀐 문구는 date_only_changes로 분리합니다. 변경의 법적 의미나 신청 자격을 판정하지 않으며, 원문 근거로 확인이 필요합니다.'
  };
}
