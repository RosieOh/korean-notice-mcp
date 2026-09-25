import path from 'node:path';
import { readDocument } from './lib/documents.js';
import { extract } from './tools.js';
import { compareNotices } from './compare.js';

const KIND = { required: '필수', conditional: '조건부', optional: '선택' };
const TYPE = {
  document_added: '서류 추가', document_removed: '서류 삭제', document_kind_changed: '필수/조건부',
  period_changed: '신청기간', modified: '문구 변경', added: '문구 추가', removed: '문구 삭제',
  table_changed: '표 변경', date_changed: '날짜만 변경'
};
// Hangul private-use bullets render as boxes in most terminals.
const tidy = s => s.replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim();
const clip = (s, n) => s.length > n ? `${s.slice(0, n - 1)}…` : s;
const where = e => e ? (e.locators ?? [e.locator]).slice(0, 2).join(',') : '-';
// Files are read from their own folder, so the folder boundary check still applies.
const load = file => readDocument(path.dirname(path.resolve(file)), path.basename(file));

function printChecklist(result) {
  console.log(`\n제출서류 ${result.requirements.length}건`);
  for (const r of result.requirements) console.log(`  [${KIND[r.kind] ?? r.kind}] ${tidy(r.name)}  (${r.evidence.locator})`);
  for (const d of result.deadlines) console.log(`\n신청기간  ${tidy(d.raw)}  (${d.evidence.locator})`);
}

export async function runCli(argv) {
  const [command, ...files] = argv;
  const top = Number(process.env.TOP ?? 10);
  if (command === 'checklist' && files.length === 1) {
    printChecklist(extract(await load(files[0])));
  } else if (command === 'compare' && files.length === 2) {
    const result = compareNotices(await load(files[0]), await load(files[1]));
    console.log(`\n${path.basename(files[0])} → ${path.basename(files[1])}: 변경 ${result.changes.length}건 (연도만 바뀐 문구 ${result.date_only_changes.length}건 별도)`);
    for (const c of result.changes.slice(0, top)) {
      console.log(`${String(c.rank).padStart(2)}. ${c.importance.padEnd(6)} ${TYPE[c.type] ?? c.type}  ${clip(tidy(c.summary), 90)}`);
      console.log(`    근거 ${where(c.before)} → ${where(c.after)}`);
    }
    printChecklist(result.checklist);
  } else {
    console.error('사용법: korean-notice-mcp compare <작년 공고> <올해 공고>\n       korean-notice-mcp checklist <공고>\n인자 없이 실행하면 MCP 서버(stdio)로 동작합니다.');
    process.exitCode = 2;
    return;
  }
  console.log('\n※ 검토용 후보입니다. 신청 전 원문 공고와 담당 부서로 확인하세요.');
}
