import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { readFile } from 'node:fs/promises';
import { ToolError } from './errors.js';

export async function invoke(tool, args) {
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) throw new ToolError('INVALID_ARGUMENT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return tool.handler(parsed.data);
}

export async function runServer(name, tools, sampleUrl) {
  if (process.argv.includes('--demo')) {
    const calls = JSON.parse(await readFile(sampleUrl, 'utf8'));
    for (const call of calls) {
      const tool = tools.find(t => t.name === call.tool);
      if (!tool) throw new Error(`Unknown demo tool: ${call.tool}`);
      console.log(JSON.stringify({ tool: call.tool, result: await invoke(tool, call.arguments) }, null, 2));
    }
    return;
  }
  const server = new McpServer({ name, version: '0.1.0' });
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async args => {
      try {
        const result = await invoke(tool, args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const result = error instanceof ToolError
          ? { error: { code: error.code, message: error.message } }
          : { error: { code: 'PROCESSING_ERROR', message: '처리하지 못했습니다. 입력 형식과 지원 범위를 확인하세요.' } };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
    });
  }
  await server.connect(new StdioServerTransport());
}
