import { z, filePath } from './lib/schemas.js';
import { dataRoot } from './lib/files.js';
import { readDocument, evidence, searchableBlocks } from './lib/documents.js';
import { fail } from './lib/errors.js';
import { compareNotices } from './compare.js';
const root = () => dataRoot(import.meta.url);

const BULLET = /^[\s○◦□■▸▶►·•\-*◎◇◆→•-]+/;
const NUMBERED = /^(?:\d{1,2}[.)](?!\d)|[가-하][.)]|[①-⑳])\s*/;
const MAIN_ENUM = /^(?:[①-⑳]|\d{1,2}[.)](?!\d))\s*/;
const SUB_ENUM = /^[㉠-㉻ⓐ-ⓩ]\s*/;
const TOPICS = [
  // Guides such as "[참고] 구비서류 발급 방법" describe documents but are not the submission list.
  ['reference', /발급\s*(?:방법|안내|요령)|작성\s*(?:방법|요령|예시)|^[\[(]?\s*참고\s*[\])]?/],
  ['documents', /^(?:(?:제출|구비|신청|필요|증빙)\s*서류|제출\s*방식)/],
  ['period', /^(?:(?:접수|신청|모집)\s*(?:및\s*공고\s*)?(?:기간|일정)|마감|접수\s*마감)/],
  ['eligibility', /^(?:(?:신청|지원|참가|모집)\s*(?:대상|자격)|자격\s*요건)/]
];
const DOC_NOUN = /(?:신청서|동의서|서약서|계획서|소개서|현황|확인서|증명서?|증명원|사본|내역서?|초본|등본|명세서|계약서|자료|통장|등록증|수급자격증|승낙서|서류|증빙|[가-힣)]서)(?:\s*\([^)]*\))?$/;
const SENTENCE = /(?:함|음|됨|임|니다|것|바람|가능|불가)[.)]?$/;
const CONDITION = /해당\s*시|해당자|해당\s*(?:서류|자료)|경우|때만|시\s*(?:추가\s*)?제출|만\s*제출|택\s*1|택일|선택|조건부/;
// On an umbrella item, "해당서류 중 1부"/"택 1" means one of the options is required, not the item being optional.
const ITEM_CONDITION = /해당\s*시|해당자|경우|때만|시\s*(?:추가\s*)?제출|만\s*제출|조건부|선택\s*사항/;
const NOTE_SUBJECT = /(?:^|[\s※])단[,\s]|[가-힣](?:자|체)는\s/;
const DATE = /\d{4}\s*[.-]\s*\d{1,2}|\d{1,2}\s*\.\s*\d{1,2}\s*\./;

const squash = s => s.replace(/\([^)]*\)/g, '').replace(/[\s·ㆍ‧]/g, '');
// Drop trailing parenthetical remarks, including one level of nesting.
const stripTail = s => { let t = s.trim(); for (let u; (u = t.replace(/\s*\((?:[^()]|\([^()]*\))*\)$/, '')) !== t;) t = u; return t; };
// A bare generic noun ("서류", "자료") is a heading fragment, not a document name.
const GENERIC = /^(?:제출|구비|첨부|증빙|관련)?\s*(?:서류|자료|증빙)$/;
const isDocName = s => { const t = stripTail(s); return t.length >= 2 && DOC_NOUN.test(t) && !SENTENCE.test(t) && !GENERIC.test(t); };
const clean = s => s.replace(BULLET, '').replace(SUB_ENUM, '').replace(MAIN_ENUM, '').replace(/\s*(?:각\s*)?\d+\s*부\.?$/, '').replace(/[.。]$/, '').trim();

// A heading is a short label (optionally bulleted, numbered or in parentheses) with a known topic.
export function heading(line) {
  const text = line.replace(BULLET, '').replace(/^※\s*/, '').replace(NUMBERED, '');
  const m = /^\(\s*([^)]{1,20})\s*\)\s*(.*)$/.exec(text) || /^([^:：]{1,20}?)\s*[:：]\s*(.*)$/.exec(text) || /^(.{1,20})$/.exec(text.trim());
  if (!m) return null;
  const label = m[1].trim().replace(/^.*?및\s*(?=제출\s*서류)/, '');
  const topic = TOPICS.find(([, re]) => re.test(label))?.[0];
  return { topic: topic ?? 'other', rest: (m[2] ?? '').trim(), label };
}
const boundary = line => /^\d{1,2}\.\s*[가-힣]/.test(line) || /^\d{1,2}$/.test(line) || /^[【\[<]?\s*(?:붙임|서식|참고)\s*\d*/.test(line) || /^□/.test(line);
const level = line => /^\d{1,2}\.|^\d{1,2}$/.test(line) ? 0 : /^□/.test(line) ? 1 : 2;

function splitList(text) {
  return text.replace(/^\(\s*필수\s*\)\s*/, '').replace(/^\(|\)$/g, '').split(/\s*[,、]\s*(?![^()]*\))/)
    .map(clean).map(s => s.replace(/\s*등$/, '')).filter(s => s.length <= 40 && isDocName(s));
}
// "※ ... 휴직자는 휴직직전 3개월 건강보험료 납부확인서 제출" → the document phrase right before 제출/첨부.
function noteDocument(text) {
  const m = /([^,:：※→]{2,60}?(?:서|증|사본|내역|초본|등본|자료))\s*(?:를|을)?\s*(?:추가\s*|반드시\s*|필수\s*)*(?:제출|첨부)/.exec(text);
  // Fallback: an object-marked document phrase, e.g. "고유번호증 또는 사업자등록증을 ... 제출".
  if (!m) return /([가-힣]+(?:\s*또는\s*[가-힣]+)?(?:증|서|사본|내역|초본|등본|자료))(?:을|를)\s/.exec(text)?.[1] ?? null;
  return m[1].replace(/^.*(?:시|경우|는|은|하며|반드시|해당|위해|도록)\s+/, '').replace(BULLET, '').trim();
}

function cellIndex(doc) {
  const index = new Map();
  for (const table of doc.tables) for (const row of table.rows) for (const cell of row) for (const locator of cell.locators ?? [cell.locator]) index.set(locator, { table, cell });
  return index;
}
// Text of other cells on the same row, including cells spanning down from rows above.
function rowContext(entry) {
  if (!entry) return '';
  const { table, cell } = entry;
  return table.rows.flat().filter(c => c !== cell && c.row <= cell.row && c.row + c.rowSpan > cell.row).map(c => c.text).join(' ');
}
function columnHeader(entry) {
  if (!entry || entry.cell.row === 0) return '';
  const { table, cell } = entry;
  return (table.rows[0] ?? []).find(c => c.column <= cell.column && c.column + c.columnSpan > cell.column)?.text ?? '';
}

export function extract(doc) {
  const requirements = [], deadlines = [], eligibility = [], warnings = [...doc.warnings];
  const cells = cellIndex(doc);
  let mode = null, modeLevel = 0, group = null, pendingPeriod = null;
  const add = (block, name, kind, condition) => {
    const key = squash(name);
    const existing = requirements.find(r => squash(r.name) === key);
    if (existing) {
      for (const l of block.locators ?? [block.locator]) if (!existing.evidence.locators.includes(l)) existing.evidence.locators.push(l);
      return;
    }
    requirements.push({ raw: block.text, name, kind, condition: kind === 'conditional' ? condition : null, evidence: { ...evidence(doc, block), locators: block.locators ?? [block.locator] }, review_status: 'needs_review' });
  };
  // A cell line ending in "및"/"또는" continues on the next line of the same cell.
  const units = [];
  for (const block of doc.blocks) {
    const prev = units.at(-1);
    if (prev && /(?:및|또는|[,·])$/.test(prev.text) && cells.get(prev.locators.at(-1))?.cell === cells.get(block.locator)?.cell && cells.has(block.locator))
      units[units.length - 1] = { ...prev, text: `${prev.text} ${block.text}`, locators: [...prev.locators, block.locator] };
    else units.push({ ...block, locators: [block.locator] });
  }
  for (const block of units) {
    const line = block.text, entry = cells.get(block.locator), inTable = Boolean(entry);
    // Enumerated table cells are list items (e.g. "① 참가자격 확인" is a form), never section headings.
    const h = inTable && (MAIN_ENUM.test(line) || SUB_ENUM.test(line)) ? null : heading(line);
    // Inside a reference guide, its table header cells ("구비서류 | 발급방법") must not reopen the documents section.
    if (h && h.topic !== 'other' && !(mode === 'reference' && inTable)) { mode = h.topic; modeLevel = inTable ? 2 : level(line.replace(BULLET, l => l.includes('□') ? '□' : '')); group = null; }
    else if (!inTable && mode && (boundary(line) && level(line) <= modeLevel || h?.rest && h.label.length <= 10 && !/^(?:해당\s*시|해당자|필수|선택|조건부)$/.test(h.label))) { mode = null; group = null; }
    if (/^[【\[]?\s*붙임|별첨/.test(line)) warnings.push(`첨부 원문을 별도로 확인하세요: ${block.locator}`);
    if (pendingPeriod && DATE.test(line)) { deadlines.push({ raw: line, evidence: { ...evidence(doc, block), locators: [block.locator] }, review_status: 'needs_review' }); pendingPeriod = null; continue; }
    if (mode === 'period' && h?.topic === 'period') {
      if (DATE.test(line)) deadlines.push({ raw: line, evidence: { ...evidence(doc, block), locators: [block.locator] }, review_status: 'needs_review' });
      else pendingPeriod = block;
      continue;
    }
    if (mode === 'eligibility') { eligibility.push({ raw: line, evidence: evidence(doc, block), review_status: 'needs_review' }); continue; }
    if (mode !== 'documents') continue;

    // Group conditions: "㉠~㉤ 중 해당서류 1부" applies to the sub-items that follow.
    if (/중\s*해당|택\s*1|택일/.test(line) && !SUB_ENUM.test(line)) group = line;
    if (/모두\s*제출/.test(line)) group = null;
    if (MAIN_ENUM.test(line) && !/[㉠-㉻]/.test(line)) group = null;
    const context = `${rowContext(entry)} ${entry ? entry.cell.text : ''}`;
    const conditionOf = text => ITEM_CONDITION.test(text) ? text : SUB_ENUM.test(line) && group ? group : /택\s*1|해당자|해당\s*시/.test(context) ? context.trim() : null;

    if (h?.topic === 'documents' || /^(?:해당\s*시|해당자|조건부|선택)\s*[:：]/.test(line.replace(BULLET, ''))) {
      const rest = h?.topic === 'documents' ? h.rest : line.replace(BULLET, '').replace(/^[^:：]+[:：]\s*/, '');
      const conditional = h?.topic !== 'documents' || (CONDITION.test(rest) && !/\(\s*필수\s*\)/.test(rest));
      for (const name of splitList(rest)) add(block, name, conditional ? 'conditional' : 'required', conditional ? line : null);
      continue;
    }
    const header = columnHeader(entry);
    // Descriptive columns (issuer, notes) are skipped unless the line is an enumerated item or a note.
    const enumerated = SUB_ENUM.test(line) || MAIN_ENUM.test(line) || /^[※▶→(]/.test(line);
    if (inTable && !enumerated && (entry.cell.row === 0 || /발급|확인\s*내용|^내\s*용$|비\s*고|제출\s*방법|^구\s*분$/.test(header.replace(/\s/g, '')) && !/서류/.test(header))) continue;
    // "(원칙) X" / "(예외) Y": alternatives inside one row; the exception is conditional.
    const alt = /^\((원칙|예외)\)\s*(.+)$/.exec(line);
    if (alt) {
      const name = alt[2].split(/\s*\(\s/)[0].trim(), condition = alt[1] === '예외' ? line : conditionOf(context);
      if (isDocName(name)) add(block, name, condition ? 'conditional' : 'required', condition);
      continue;
    }
    if (/^\(.*[,、].*\)$/.test(line)) {
      const condition = conditionOf(context);
      for (const name of splitList(line)) add(block, name, condition ? 'conditional' : 'required', condition);
      continue;
    }
    if (/^[※▶→(]|^\s*[-*]/.test(line) || /제출|첨부/.test(line) && !SUB_ENUM.test(line) && !MAIN_ENUM.test(line)) {
      const name = CONDITION.test(line) || NOTE_SUBJECT.test(line) || /추가\s*제출|첨부/.test(line) ? noteDocument(line) : null;
      if (name && isDocName(name)) add(block, name, 'conditional', line);
      continue;
    }
    const name = clean(line).split(/\s*▶|\s+-\s|\s+※(?![^()]*\))/)[0].trim();
    if (!(SUB_ENUM.test(line) || MAIN_ENUM.test(line) || inTable) || name.length > 50 || !isDocName(name)) continue;
    const condition = conditionOf(line);
    add(block, name, condition ? 'conditional' : 'required', condition);
  }
  if (!requirements.length) warnings.push('제출서류 후보를 찾지 못했습니다. 서류가 없다는 뜻은 아닙니다.');
  if (!deadlines.length) warnings.push('기한을 찾지 못했습니다. 원문을 확인하세요.');
  if (deadlines.length > 1) warnings.push('기한 후보가 여러 개입니다. 동일 기한인지 충돌하는지 원문을 대조하세요.');
  return { file: doc.file, sha256: doc.sha256, requirements, deadlines, eligibility, warnings: [...new Set(warnings)], scope: '제목·표 구조 기반 후보 추출. 자격·필수 여부·날짜를 확정하지 않습니다.' };
}

export const tools = [
  { name: 'read_notice', description: '공고문(TXT/MD/HWPX/HWP) 텍스트와 표를 원문 위치·해시와 함께 읽습니다. PDF 제외.', inputSchema: z.object({ path: filePath }), handler: ({path}) => readDocument(root(), path) },
  { name: 'extract_requirements', description: '공고의 제출서류(필수/조건부)·신청기간·자격 후보와 원문 근거를 추출합니다. 결과는 검토가 필요합니다.', inputSchema: z.object({ path: filePath }), handler: async ({path}) => extract(await readDocument(root(), path)) },
  { name: 'compare_notices', description: '전년도와 올해 공고의 제출서류·신청기간 변화와 주요 변경 문구를 중요도 순으로, 양쪽 원문 근거와 함께 비교합니다.', inputSchema: z.object({ before_path: filePath, after_path: filePath }), handler: async ({before_path, after_path}) => {
    const [before, after] = await Promise.all([readDocument(root(), before_path), readDocument(root(), after_path)]);
    return compareNotices(before, after);
  } },
  { name: 'get_evidence', description: '동일한 해시의 문서에서 위치에 해당하는 원문을 확인합니다.', inputSchema: z.object({ path: filePath, sha256: z.string().regex(/^[a-f0-9]{64}$/), locator: z.string().min(1).max(200) }), handler: async ({path,sha256,locator}) => {
    const doc = await readDocument(root(), path);
    if (doc.sha256 !== sha256) fail('DOCUMENT_CHANGED', '문서가 변경되었습니다. 다시 분석하세요.');
    const block = [...doc.blocks, ...searchableBlocks(doc)].find(b => b.locator === locator);
    if (!block) fail('LOCATION_NOT_FOUND', '원문 위치가 없습니다.');
    return { evidence: evidence(doc,block) };
  } }
];
