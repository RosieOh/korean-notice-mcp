import { zipSync, strToU8 } from 'fflate';
// Minimal structural HWPX fixture, not a full Hancom rendering fixture.
export function makeHwpx(paragraphs, rows = []) {
  const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const p = s => `<hp:p><hp:run><hp:t>${escape(s)}</hp:t></hp:run></hp:p>`;
  const table = rows.length ? `<hp:p><hp:run><hp:tbl>${rows.map((r,ri)=>`<hp:tr>${r.map((s,ci)=>`<hp:tc><hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:subList>${p(s)}</hp:subList></hp:tc>`).join('')}</hp:tr>`).join('')}</hp:tbl></hp:run></hp:p>` : '';
  return zipSync({mimetype:strToU8('application/hwp+zip'),'Contents/section0.xml':strToU8(`<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${paragraphs.map(p).join('')}${table}</hs:sec>`)});
}
