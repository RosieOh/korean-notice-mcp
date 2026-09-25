import { Worker } from 'node:worker_threads';
import { ToolError } from './errors.js';
export function parseRhwp(bytes) {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL('./rhwp-worker.js',import.meta.url),{workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:128},stdout:true,stderr:true});
    // Native parser diagnostics must not corrupt the MCP stdio stream.
    worker.stdout.resume();worker.stderr.resume();
    let settled=false;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();
      error?reject(error):resolve(result);
    };
    const timer=setTimeout(()=>finish(new ToolError('PARSER_TIMEOUT','한글 파서 처리 시간(10초)을 초과했습니다.')),10000);
    worker.on('message',result=>result.error?finish(new ToolError('PARSER_FAILED','rhwp가 문서를 읽지 못했습니다. 암호·손상·지원 형식을 확인하세요.')):finish(null,result));
    worker.on('error',()=>finish(new ToolError('PARSER_FAILED','한글 파서 작업이 실패했습니다.')));
    worker.on('exit',()=>{if(!settled)finish(new ToolError('PARSER_FAILED','한글 파서 작업이 조기 종료되었습니다.'));});
  });
}
