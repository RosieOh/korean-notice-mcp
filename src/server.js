#!/usr/bin/env node
import { runServer } from './lib/runtime.js';
import { tools } from './tools.js';

const [command] = process.argv.slice(2);
if (command === 'compare' || command === 'checklist' || command === 'help') {
  const { runCli } = await import('./cli.js');
  await runCli(process.argv.slice(2)).catch(error => {
    console.error(error.message ?? '처리하지 못했습니다.');
    process.exitCode = 1;
  });
} else {
  runServer('korean-notice-mcp', tools, new URL('../examples/demo.json', import.meta.url)).catch(() => {
    console.error('서버 실행 실패. 입력과 README의 설치 방법을 확인하세요.');
    process.exitCode = 1;
  });
}
