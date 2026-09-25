import * as z from 'zod/v4';
export { z };
export const filePath = z.string().min(1).max(1024).describe('MCP_DATA_DIR 기준 상대 파일 경로');
export const text = z.string().trim().min(1).max(2000);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === value;
}, '실제로 존재하는 YYYY-MM-DD 날짜가 필요합니다.');
export const source = z.object({ title: text, url: z.url().optional(), locator: text, quote: text }).strict();
