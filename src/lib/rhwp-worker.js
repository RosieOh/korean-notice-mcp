import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { HwpDocument, initSync } from '@rhwp/core';

const squash = s => String(s ?? '').replace(/\s+/g, '');

// Rebuild table cells with the rhwp table API, then attach each cell to the scan-order
// blocks that carry its text, so evidence locators stay in the rhwp/scanN space.
function readTables(doc, blocks) {
  const warnings = [];
  const controls = JSON.parse(doc.getControls()).filter(c => c.ctrlId === 'tbl');
  if (controls.length > 500) throw new Error('table_limit');
  const tables = [];
  let cursor = 0, skipped = 0;
  for (const control of controls) {
    let dim;
    try { dim = JSON.parse(doc.getTableDimensions(control.list, control.para, control.controlIndex)); }
    catch { skipped++; continue; }
    if (!(dim.cellCount > 0) || dim.cellCount > 2000) { skipped++; continue; }
    const cells = [];
    for (let index = 0; index < dim.cellCount; index++) {
      const info = JSON.parse(doc.getCellInfo(control.list, control.para, control.controlIndex, index));
      const count = doc.getCellParagraphCount(control.list, control.para, control.controlIndex, index);
      const paragraphs = [];
      for (let p = 0; p < count && p < 200; p++) {
        const length = doc.getCellParagraphLength(control.list, control.para, control.controlIndex, index, p);
        paragraphs.push(length ? doc.getTextInCell(control.list, control.para, control.controlIndex, index, p, 0, length) : '');
      }
      cells.push({ row: info.row, column: info.col, rowSpan: info.rowSpan, columnSpan: info.colSpan, paragraphs, locators: [] });
    }
    // Align cell paragraphs to scan blocks in order; a paragraph may be split across
    // several scan items (fields, links), and unmatched scan items are skipped.
    let matched = 0, start = cursor;
    for (const cell of cells) for (const paragraph of cell.paragraphs) {
      const target = squash(paragraph);
      if (!target) continue;
      // The first cell may be far ahead of the previous table; later cells stay close.
      const window = matched ? 40 : (target.length >= 4 ? blocks.length : 80);
      for (let i = start; i < Math.min(blocks.length, start + window); i++) {
        if (blocks[i].cell) continue;
        let acc = '', j = i;
        for (; j < blocks.length; j++) {
          const next = acc + squash(blocks[j].text);
          if (!target.startsWith(next)) break;
          acc = next;
          if (acc.length === target.length) break;
        }
        if (acc !== target) continue;
        for (let k = i; k <= j; k++) { blocks[k].cell = cell; cell.locators.push(blocks[k].locator); }
        start = j + 1; matched++;
        break;
      }
    }
    if (!matched) { skipped++; continue; }
    cursor = start;
    const locator = `rhwp/table${tables.length + 1}`;
    const rows = [];
    for (const cell of cells) {
      (rows[cell.row] ||= []).push({ text: cell.paragraphs.map(p => p.trim()).filter(Boolean).join('\n'), row: cell.row, column: cell.column, rowSpan: cell.rowSpan, columnSpan: cell.columnSpan, locator: cell.locators[0] ?? `${locator}/row${cell.row + 1}/cell${cell.column + 1}`, locators: cell.locators });
    }
    tables.push({ locator, rows: Array.from(rows, r => r ?? []) });
  }
  for (const block of blocks) delete block.cell;
  if (skipped) warnings.push(`rhwp 표 ${skipped}개는 행·열 구조를 복원하지 못해 셀 텍스트만 사용했습니다.`);
  return { tables, warnings };
}

let doc;
try {
  initSync({ module: await readFile(new URL('rhwp_bg.wasm', import.meta.resolve('@rhwp/core'))) });
  doc = new HwpDocument(new Uint8Array(workerData));
  const items = JSON.parse(doc.getScanItems());
  if (!Array.isArray(items) || items.length > 30000) throw new Error('scan_limit');
  const blocks = items.map((item,index) => ({ locator:`rhwp/scan${index+1}`, text:String(item.text ?? '').trim() })).filter(item=>item.text);
  if (blocks.reduce((n,b)=>n+b.text.length,0)>300000 || blocks.length>10000) throw new Error('text_limit');
  let tables = [], tableWarnings = [];
  try { ({ tables, warnings: tableWarnings } = readTables(doc, blocks)); }
  catch { tableWarnings = ['rhwp 표 구조를 읽지 못해 셀 텍스트만 사용했습니다.']; for (const block of blocks) delete block.cell; }
  parentPort.postMessage({ blocks, tables, parser:'rhwp-0.8.6', warnings:[
    'rhwp 스캔 순서로 추출했습니다. 위치는 rhwp/scanN이며 페이지·원본 XML 좌표가 아닙니다. 동일 해시와 엔진 버전으로 재확인하세요.',
    '이미지·도형의 글자와 OCR은 지원하지 않습니다.',
    ...tableWarnings
  ] });
} catch { parentPort.postMessage({ error:'R HWP parser failed' }); }
finally { doc?.free(); }
