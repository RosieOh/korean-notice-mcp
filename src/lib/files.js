import { realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, ToolError } from './errors.js';

export function dataRoot(moduleUrl) {
  return process.env.MCP_DATA_DIR || fileURLToPath(new URL('../examples/', moduleUrl));
}

export async function readAllowed(root, requested, maxBytes = 2 * 1024 * 1024) {
  if (typeof requested !== 'string' || !requested.trim() || requested.includes('\0')) fail('INVALID_PATH', '파일 경로가 필요합니다.');
  let base, target;
  try { base = await realpath(root); target = await realpath(path.resolve(base, requested)); }
  catch { fail('FILE_NOT_FOUND', '데이터 폴더 또는 파일을 찾을 수 없습니다. MCP_DATA_DIR과 경로를 확인하세요.'); }
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('PATH_DENIED', '허용한 데이터 폴더 밖의 파일은 읽을 수 없습니다.');
  let handle;
  try {
    handle = await open(target, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) fail('NOT_A_FILE', '일반 파일만 읽을 수 있습니다.');
    if (stat.size > maxBytes) fail('FILE_TOO_LARGE', `입력 파일은 ${maxBytes}바이트 이하여야 합니다.`);
    const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!part.bytesRead) break;
      bytesRead += part.bytesRead;
    }
    if (bytesRead > maxBytes || bytesRead > stat.size) fail('FILE_CHANGED', '읽는 중 파일이 변경되었습니다. 다시 시도하세요.');
    return { bytes: buffer.subarray(0, bytesRead), extension: path.extname(target).toLowerCase() };
  } catch (error) {
    if (!(error instanceof ToolError)) fail('READ_ERROR', '파일을 읽을 수 없습니다.');
    throw error;
  } finally { await handle?.close(); }
}

export async function readJson(root, requested, schema) {
  const { bytes, extension } = await readAllowed(root, requested);
  if (extension !== '.json') fail('UNSUPPORTED_FORMAT', 'JSON 파일을 지정하세요.');
  let value;
  try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { fail('INVALID_JSON', 'JSON 문법을 확인하세요.'); }
  const result = schema.safeParse(value);
  if (!result.success) fail('INVALID_DATA', result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 1500));
  return result.data;
}
