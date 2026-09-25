// Frozen 0.1.0 baseline (heading-rule extraction + line diff). Do not tune against evaluation cases.
import { evidence, searchableBlocks } from '../src/lib/documents.js';
import { fail } from '../src/lib/errors.js';
export function extract(doc) {
  const requirements = [], deadlines = [], eligibility = [], warnings = [...doc.warnings];
  let mode = null;
  for (const block of searchableBlocks(doc)) {
    const line = block.text;
    if (/^(?:#{1,6}\s*)?(?:제출\s*서류|구비\s*서류|접수\s*서류)/.test(line)) mode = 'documents';
    else if (/^(?:#{1,6}\s*)?(?:접수\s*기간|신청\s*기간|마감|접수\s*마감)/.test(line)) mode = 'deadline';
    else if (/^(?:#{1,6}\s*)?(?:신청\s*대상|지원\s*대상|신청\s*자격)/.test(line)) mode = 'eligibility';
    else if (/^(?:#{1,6}\s|[가-힣 ]{2,15}\s*:)/.test(line) && !/^(해당\s*시|필수|선택|조건부)/.test(line)) mode = null;
    const entry = { raw: line, evidence: evidence(doc, block), review_status: 'needs_review' };
    if (mode === 'documents') {
      const content = line.replace(/^(?:#{1,6}\s*)?(?:제출\s*서류|구비\s*서류|접수\s*서류)\s*[:：]?\s*/, '').replace(/^[-*]\s*/, '');
      if (content) {
        const conditional = /해당\s*시|해당자|경우|조건부|사용\s*시/.test(content);
        const optional = /선택|선택사항/.test(content);
        requirements.push({ ...entry, name: content, kind: conditional ? 'conditional' : optional ? 'optional' : 'required_candidate', condition: conditional ? content : null });
      }
    }
    if (mode === 'deadline') deadlines.push(entry);
    if (mode === 'eligibility') eligibility.push(entry);
    if (/붙임|별첨/.test(line)) warnings.push(`첨부 원문을 별도로 확인하세요: ${block.locator}`);
  }
  if (!requirements.length) warnings.push('제출서류 후보를 찾지 못했습니다. 서류가 없다는 뜻은 아닙니다.');
  if (!deadlines.length) warnings.push('기한을 찾지 못했습니다. 원문을 확인하세요.');
  if (deadlines.length > 1) warnings.push('기한 후보가 여러 개입니다. 동일 기한인지 충돌하는지 원문을 대조하세요.');
  return { file: doc.file, sha256: doc.sha256, requirements, deadlines, eligibility, warnings: [...new Set(warnings)], scope: '제목 기반 후보 추출. 자격·필수 여부·날짜를 확정하지 않습니다.' };
}


// Line-level LCS diff from guideline-diff-mcp 0.1.0.
export function diffDocuments(before, after) {
  const a = before.blocks, b = after.blocks;
  if (a.length > 1200 || b.length > 1200) fail('DIFF_TOO_LARGE', '비교는 문서당 1,200개 블록까지 지원합니다.');
  const normalize = s => s.replace(/\s+/g,' ').trim();
  const table = Array.from({length:a.length+1}, () => new Uint16Array(b.length+1));
  for (let i=a.length-1;i>=0;i--) for(let j=b.length-1;j>=0;j--) table[i][j] = normalize(a[i].text) === normalize(b[j].text) ? 1+table[i+1][j+1] : Math.max(table[i+1][j],table[i][j+1]);
  const changes = []; let i=0,j=0;
  while(i<a.length || j<b.length) {
    if (i<a.length && j<b.length && normalize(a[i].text) === normalize(b[j].text)) { i++; j++; }
    else if(j<b.length && (i===a.length || table[i][j+1] >= table[i+1][j])) changes.push({ type:'added', after:evidence(after,b[j++]) });
    else changes.push({ type:'removed', before:evidence(before,a[i++]) });
  }
  return { changed: changes.length > 0, changes };
}
