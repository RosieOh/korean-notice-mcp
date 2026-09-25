#!/usr/bin/env node
import { runServer } from './lib/runtime.js';
import { tools } from './tools.js';
runServer('korean-notice-mcp', tools, new URL('../examples/demo.json', import.meta.url)).catch(() => {
  console.error('서버 실행 실패. 입력과 README의 설치 방법을 확인하세요.');
  process.exitCode = 1;
});

