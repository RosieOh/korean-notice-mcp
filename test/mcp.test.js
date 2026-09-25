import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { tools } from '../src/tools.js';
const demo=JSON.parse(await readFile(new URL('../examples/demo.json',import.meta.url),'utf8'));
test('MCP stdio: 초기화·도구 목록·실제 호출·근거 재확인·경로 차단',{timeout:20000},async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.js',import.meta.url))],stderr:'pipe'});
  let stderr='';transport.stderr.on('data',data=>{stderr+=data.toString();});
  const client=new Client({name:'gonggo-mcp-integration-test',version:'0.2.0'});
  try{
    await client.connect(transport);
    const listing=await client.listTools();
    assert.deepEqual(listing.tools.map(t=>t.name).sort(),tools.map(t=>t.name).sort());
    for(const call of demo){
      const r=await client.callTool({name:call.tool,arguments:call.arguments});
      assert.notEqual(r.isError,true,JSON.stringify(r));assert.ok(r.structuredContent);assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);
    }
    const read=(await client.callTool({name:'read_notice',arguments:{path:'notice.txt'}})).structuredContent;
    const evidence=await client.callTool({name:'get_evidence',arguments:{path:'notice.txt',sha256:read.sha256,locator:read.blocks[0].locator}});
    assert.equal(evidence.structuredContent.evidence.quote,read.blocks[0].text);
    const denied=await client.callTool({name:'extract_requirements',arguments:{path:'../package.json'}});
    assert.equal(denied.isError,true);assert.equal(JSON.parse(denied.content[0].text).error.code,'PATH_DENIED');
    assert.equal(stderr,'');
  }finally{await client.close();await transport.close();}
});
