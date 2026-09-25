import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import yauzl from 'yauzl';
import { parse as parseCsv } from 'csv-parse/sync';
import { readAllowed } from './files.js';
import { fail } from './errors.js';
import { parseRhwp } from './rhwp.js';

const LIMIT = 8 * 1024 * 1024;
function unzipSections(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      let size = 0, count = 0, finished = false;
      const sections = [], names = new Set();
      const timer = setTimeout(() => stop(new Error('ZIP timeout')), 3000);
      function stop(err) { if (finished) return; finished = true; clearTimeout(timer); zip.close(); err ? reject(err) : resolve(sections); }
      zip.on('error', stop);
      zip.on('end', () => stop());
      zip.on('entry', entry => {
        if (++count > 512 || entry.uncompressedSize > LIMIT || (size += entry.uncompressedSize) > LIMIT) return stop(new Error('ZIP limits'));
        if (names.has(entry.fileName)) return stop(new Error('Duplicate ZIP entry'));
        names.add(entry.fileName);
        if (!/^Contents\/section\d+\.xml$/.test(entry.fileName)) { zip.readEntry(); return; }
        if (entry.generalPurposeBitFlag & 1) return stop(new Error('Encrypted ZIP'));
        zip.openReadStream(entry, (err, stream) => {
          if (err) return stop(err);
          let actual = 0; const chunks = [];
          stream.on('data', chunk => {
            actual += chunk.length;
            if (actual > LIMIT || actual > entry.uncompressedSize) { stream.destroy(new Error('ZIP limits')); return; }
            chunks.push(chunk);
          });
          stream.on('error', stop);
          stream.on('end', () => { if (finished) return; sections.push({ name: entry.fileName, xml: Buffer.concat(chunks).toString('utf8') }); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

function descendants(nodes, target, result = []) {
  for (const node of nodes || []) for (const [key, children] of Object.entries(node)) {
    if (key === target) result.push({ children, attrs: node[':@'] || {} });
    else if (Array.isArray(children)) descendants(children, target, result);
  }
  return result;
}
// Visible text lives only in <hp:t>; field parameters (e.g. hyperlink commands) must not leak into the body.
function textContent(nodes, inText = false) {
  let result = '';
  for (const node of nodes || []) for (const [key, children] of Object.entries(node)) {
    if (key === '#text') { if (inText) result += String(children); }
    else if (key !== 'tbl' && key !== 'parameters' && Array.isArray(children)) result += textContent(children, inText || key === 't') + (key === 'p' ? '\n' : '');
  }
  return result;
}

async function hwpx(bytes) {
  let sections;
  try { sections = await unzipSections(bytes); } catch { fail('INVALID_HWPX', 'HWPX가 손상되었거나 압축 해제 제한(8MB / 512개 / 3초)을 초과했습니다.'); }
  if (!sections.length) fail('INVALID_HWPX', 'Contents/sectionN.xml이 없습니다.');
  sections.sort((a,b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const blocks = [], tables = [], warnings = ['HWPX의 이미지·도형·각주·머리말은 지원하지 않습니다. 페이지 번호 대신 구조 위치를 사용합니다.'];
  for (const { name, xml } of sections) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('UNSAFE_XML', 'DTD와 사용자 엔티티는 허용하지 않습니다.');
    if (XMLValidator.validate(xml) !== true) fail('INVALID_XML', 'HWPX XML 문법이 올바르지 않습니다.');
    let tree;
    try { tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false, maxNestedTags: 80 }).parse(xml); }
    catch { fail('INVALID_XML', 'XML이 손상되었거나 중첩 깊이 제한을 초과했습니다.'); }
    const section = name.replace('Contents/', '').replace('.xml','');
    let paragraph = 0, tableIndex = 0;
    // Visit in source order; table cells are handled separately to avoid duplicate paragraphs.
    function visit(nodes, depth = 0) {
      if (depth > 80) fail('DOCUMENT_TOO_COMPLEX', 'XML 중첩 깊이 제한을 초과했습니다.');
      for (const node of nodes || []) for (const [key, children] of Object.entries(node)) {
        if (!Array.isArray(children)) continue;
        if (key === 'p') {
          const value = textContent(children).trim();
          if (value) blocks.push({ locator: `${section}/paragraph${++paragraph}`, text: value });
          visit(children, depth + 1);
        } else if (key === 'tbl') {
          if (descendants(children, 'tbl').length) fail('NESTED_TABLE_UNSUPPORTED', '표 안에 중첩된 표는 아직 지원하지 않습니다.');
          const locator = `${section}/table${++tableIndex}`;
          const rows = descendants(children, 'tr').map((row, ri) => descendants(row.children, 'tc').map((cell, ci) => {
            const addr = descendants(cell.children, 'cellAddr')[0]?.attrs;
            const span = descendants(cell.children, 'cellSpan')[0]?.attrs;
            const value = textContent(cell.children).trim();
            const item = { text: value, row: Number(addr?.['@_rowAddr'] ?? ri), column: Number(addr?.['@_colAddr'] ?? ci), rowSpan: Number(span?.['@_rowSpan'] ?? 1), columnSpan: Number(span?.['@_colSpan'] ?? 1) };
            if (![item.row,item.column,item.rowSpan,item.columnSpan].every(Number.isSafeInteger) || item.row < 0 || item.column < 0 || item.rowSpan < 1 || item.columnSpan < 1) fail('INVALID_TABLE', '표의 셀 좌표 또는 병합 범위가 올바르지 않습니다.');
            item.locator = `${locator}/row${item.row + 1}/cell${item.column + 1}`;
            if (value) blocks.push({ locator: item.locator, text: value });
            return item;
          }));
          tables.push({ locator, rows });
        } else visit(children, depth + 1);
      }
    }
    visit(tree);
  }
  return { blocks, tables, warnings };
}

export function csvRows(content) {
  try {
    const rows = parseCsv(content, { bom: true, skip_empty_lines: true, max_record_size: 100000 });
    if (rows.length > 5000 || rows.some(r => r.length > 100)) fail('TABLE_TOO_LARGE', 'CSV는 최대 5,000행, 100열입니다.');
    return rows;
  } catch(error) {
    if (error.code === 'TABLE_TOO_LARGE') throw error;
    fail('INVALID_CSV', 'CSV의 따옴표, 열 개수, 행 길이를 확인하세요.');
  }
}

export async function readDocument(root, file, { parser = 'auto' } = {}) {
  const { bytes, extension } = await readAllowed(root, file);
  const hash = createHash('sha256').update(bytes).digest('hex');
  let parsed;
  if (!['auto','native','rhwp'].includes(parser)) fail('INVALID_PARSER', 'auto/native/rhwp 중 선택하세요.');
  if ((extension === '.hwp' && parser !== 'native') || (extension === '.hwpx' && parser === 'rhwp')) parsed = await parseRhwp(bytes);
  else if (extension === '.hwpx') {
    try { parsed = { ...await hwpx(bytes), parser:'native-hwpx' }; }
    catch(error) {
      if (parser !== 'auto' || error.code !== 'NESTED_TABLE_UNSUPPORTED') throw error;
      parsed = await parseRhwp(bytes);
      parsed.warnings.unshift('자체 파서가 중첩 표를 지원하지 않아 rhwp 텍스트 추출로 전환했습니다.');
    }
  }
  else if (['.txt','.md','.csv'].includes(extension)) {
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('INVALID_ENCODING', 'UTF-8로 저장한 파일을 사용하세요.'); }
    if (extension === '.csv') {
      const rows = csvRows(content).map((r,ri) => r.map((t,ci) => ({ text: t, row: ri, column: ci, rowSpan: 1, columnSpan: 1, locator: `table1/row${ri+1}/cell${ci+1}` })));
      parsed = { blocks: rows.flat().filter(c => c.text).map(c => ({ locator: c.locator, text: c.text })), tables: [{ locator: 'table1', rows }], warnings: [] };
    } else parsed = { blocks: content.split(/\r?\n/).map((text,i) => ({ locator: `line${i+1}`, text: text.trim() })).filter(b => b.text), tables: [], warnings: [] };
  } else fail('UNSUPPORTED_FORMAT', '지원 형식: .txt, .md, .csv, .hwpx, .hwp(rhwp). PDF/OCR은 미지원입니다.');
  if (parsed.blocks.length > 10000 || parsed.blocks.reduce((n,b) => n + b.text.length, 0) > 300000) fail('DOCUMENT_TOO_LARGE', '추출 본문은 최대 300,000자, 10,000개 블록입니다.');
  if (!parsed.blocks.length) parsed.warnings.push('읽을 수 있는 텍스트가 없습니다.');
  return { file, sha256: hash, parser:parsed.parser || 'native-text', ...parsed };
}

export function evidence(doc, block) { return { file: doc.file, sha256: doc.sha256, parser:doc.parser, locator: block.locator, quote: block.text }; }
export function searchableBlocks(doc) {
  const rowByCell = new Map(), emitted = new Set(), result = [];
  for (const table of doc.tables) for (const [i,row] of table.rows.entries()) {
    const block = { locator: `${table.locator}/row${i+1}`, text: row.map(c=>c.text).join(' : ') };
    for(const cell of row) rowByCell.set(cell.locator,block);
  }
  for (const block of doc.blocks) {
    const row = rowByCell.get(block.locator);
    if (!row) result.push(block);
    else if (!emitted.has(row.locator)) { result.push(row); emitted.add(row.locator); }
  }
  return result;
}
