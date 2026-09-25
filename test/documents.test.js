import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, readdir, rmdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync,strToU8 } from 'fflate';
import { readAllowed } from '../src/lib/files.js';
import { readDocument,csvRows,searchableBlocks } from '../src/lib/documents.js';
import { makeHwpx } from './fixtures.js';
const examples=fileURLToPath(new URL('../examples/',import.meta.url));
async function tempFiles(fn){
  const directory=await mkdtemp(path.join(tmpdir(),'gonggo-mcp-test-'));
  try{return await fn(directory);}finally{
    // Only unlink files/symlinks created inside this freshly allocated test directory.
    for(const file of await readdir(directory))await unlink(path.join(directory,file));
    await rmdir(directory);
  }
}
test('파일 경계: 상위 폴더와 절대 경로 이탈 차단',async()=>{
  await assert.rejects(readAllowed(examples,'../package.json'),{code:'PATH_DENIED'});
  await assert.rejects(readAllowed(examples,fileURLToPath(new URL('../README.md',import.meta.url))),{code:'PATH_DENIED'});
});
test('파일 경계: 없는 파일과 폴더를 구분하고 크기 제한',async()=>{
  await assert.rejects(readAllowed(examples,'absent.txt'),{code:'FILE_NOT_FOUND'});
  await assert.rejects(readAllowed(examples,'.'),{code:'NOT_A_FILE'});
  await assert.rejects(readAllowed(examples,'notice.txt',1),{code:'FILE_TOO_LARGE'});
});
test('파일 경계: 바깥 파일로 연결된 symlink 차단',async t=>tempFiles(async dir=>{
  try{await symlink(fileURLToPath(new URL('../README.md',import.meta.url)),path.join(dir,'link.txt'),'file');}
  catch(e){if(e.code==='EPERM'){t.skip('Windows symlink 생성 권한 없음');return;}throw e;}
  await assert.rejects(readAllowed(dir,'link.txt'),{code:'PATH_DENIED'});
}));
test('문서: 지원하지 않는 형식과 잘못된 UTF-8 거부',async()=>tempFiles(async dir=>{
  await writeFile(path.join(dir,'x.hwp'),'fake');await assert.rejects(readDocument(dir,'x.hwp'),{code:'PARSER_FAILED'});
  await writeFile(path.join(dir,'x.pdf'),'fake');await assert.rejects(readDocument(dir,'x.pdf'),{code:'UNSUPPORTED_FORMAT'});
  await writeFile(path.join(dir,'x.txt'),Buffer.from([0xff,0xfe]));await assert.rejects(readDocument(dir,'x.txt'),{code:'INVALID_ENCODING'});
}));
test('HWPX: 엔티티 해석 금지 및 손상 ZIP 처리',async()=>tempFiles(async dir=>{
  await writeFile(path.join(dir,'x.hwpx'),'broken');await assert.rejects(readDocument(dir,'x.hwpx'),{code:'INVALID_HWPX'});
  const xml='<!DOCTYPE sec [<!ENTITY x SYSTEM "file:///etc/passwd">]><sec>&x;</sec>';
  await writeFile(path.join(dir,'x.hwpx'),zipSync({'Contents/section0.xml':strToU8(xml)}));
  await assert.rejects(readDocument(dir,'x.hwpx'),{code:'UNSAFE_XML'});
}));
test('HWPX: 과도한 압축 해제 크기를 거부',async()=>tempFiles(async dir=>{
  await writeFile(path.join(dir,'large.hwpx'),zipSync({'Contents/section0.xml':new Uint8Array(9*1024*1024)}));
  await assert.rejects(readDocument(dir,'large.hwpx'),{code:'INVALID_HWPX'});
}));
test('HWPX: 한글과 XML 이스케이프 및 표 구조를 보존',async()=>tempFiles(async dir=>{
  await writeFile(path.join(dir,'x.hwpx'),makeHwpx(['신청서 & 사업계획서'],[['제출서류','신청서'],['기한','2026-10-01']]));
  const d=await readDocument(dir,'x.hwpx');assert.equal(d.blocks[0].text,'신청서 & 사업계획서');assert.equal(d.tables[0].rows[1][1].text,'2026-10-01');
  assert.equal(searchableBlocks(d)[1].text,'제출서류 : 신청서');
}));
test('CSV: 인용된 쉼표와 BOM 지원, 불균일 열 거부',()=>{
  assert.deepEqual(csvRows('\uFEFF항목,금액\n인쇄비,"10,000"'),[['항목','금액'],['인쇄비','10,000']]);
  assert.throws(()=>csvRows('a,b\nx,y,z'),{code:'INVALID_CSV'});
});
