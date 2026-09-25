import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tools, extract } from '../src/tools.js';
import { compareNotices } from '../src/compare.js';
import { readDocument } from '../src/lib/documents.js';
import { invoke } from '../src/lib/runtime.js';
const call=(name,args)=>invoke(tools.find(t=>t.name===name),args);
test('공고: 조건부 요건과 기한, 원문 근거가 유지된다',async()=>{
  for(const path of ['notice.txt','notice.hwpx']){
    const result=await call('extract_requirements',{path});
    assert.deepEqual(result.requirements.map(r=>r.kind),['required','required','conditional']);
    assert.deepEqual(result.requirements.slice(0,2).map(r=>r.name),['신청서','사업계획서']);
    assert.match(result.requirements[2].name,/사용승낙서$/);
    assert.equal(result.deadlines.length,1);
    const item=result.requirements[0];
    const original=await call('get_evidence',{path,sha256:result.sha256,locator:item.evidence.locator});
    assert.equal(original.evidence.quote,item.evidence.quote);
  }
});
test('공고: 변경된 해시를 거부하고 미발견을 경고한다',async()=>{
  await assert.rejects(call('get_evidence',{path:'notice.txt',sha256:'0'.repeat(64),locator:'line1'}),{code:'DOCUMENT_CHANGED'});
  const result=extract({file:'empty',sha256:'x',blocks:[],tables:[],warnings:[]});
  assert.equal(result.requirements.length,0);assert.ok(result.warnings.length>=2);
});
test('공고 비교: 서류·기간 변경을 앞에 두고 연도만 바뀐 문구는 분리한다',()=>{
  const doc=(file,lines)=>({file,sha256:file,parser:'test',tables:[],warnings:[],blocks:lines.map((text,i)=>({locator:`line${i+1}`,text}))});
  const before=doc('a',['2025년 모집 공고','접수기간: 2025. 3. 4. ~ 2025. 3. 17.','제출서류: 신청서, 주민등록초본','문의: 2025년 담당']);
  const after=doc('b',['2026년 모집 공고','접수기간: 2026. 5. 1. ~ 2026. 5. 20.','제출서류: 신청서, 주민등록초본, 소득증빙자료','문의: 2026년 담당']);
  const result=compareNotices(before,after);
  assert.deepEqual(result.changes.slice(0,2).map(c=>c.type).sort(),['document_added','period_changed']);
  assert.ok(result.changes.every(c=>c.before||c.after));
  assert.equal(result.date_only_changes.length,2);
});
// Real public notices are kept out of the repository; run npm run fetch-corpus to enable.
const raw=fileURLToPath(new URL('../data/raw/',import.meta.url));
const corpus=await access(raw).then(()=>true,()=>false);
test('실제 공고(로컬): rhwp 표 구조 복원과 제출서류 추출',{skip:!corpus&&'data/raw 없음 (npm run fetch-corpus)'},async()=>{
  const doc=await readDocument(raw,'housing-2025.hwp',{parser:'rhwp'});
  const table=doc.tables.find(t=>t.rows[0]?.some(c=>c.text==='제출서류'));
  assert.ok(table,'제출서류 표를 행·열로 복원해야 합니다');
  const names=extract(doc).requirements.map(r=>r.name);
  for(const name of ['지원신청서','서약서','통장사본(본인)','재직증명서']) assert.ok(names.includes(name),name);
});
test('CLI: compare가 사람이 읽는 순위 목록을 출력한다',async()=>{
  const { execFile } = await import('node:child_process');
  const examples=fileURLToPath(new URL('../examples/',import.meta.url));
  const out=await new Promise((resolve,reject)=>execFile(process.execPath,[fileURLToPath(new URL('../src/server.js',import.meta.url)),'compare',examples+'before.txt',examples+'after.txt'],(e,stdout)=>e?reject(e):resolve(stdout)));
  assert.match(out,/1\. high\s+서류 추가\s+제출서류 추가 후보: 주민등록초본/);
  assert.match(out,/\[조건부\] 사업자등록증 사본/);
});
