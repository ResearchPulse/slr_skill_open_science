import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const serverEntry = fileURLToPath(new URL('../out/index.js', import.meta.url));

describe('SLR MCP stdio entrypoint', () => {
  it('negotiates over stdio and exposes screening and extraction tools', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: packageRoot,
      env: {
        SLR_API_BASE_URL: 'http://127.0.0.1:3000/api',
        SLR_AGENT_TOKEN: 'slrp_test_secret',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });

    await client.connect(transport);
    const result = await client.listTools();

    expect(result.tools.map(tool => tool.name)).toEqual([
      'list_assigned_tasks',
      'connection_test',
      'get_assigned_task',
      'get_task_fulltext',
      'submit_review_result',
      'get_extraction_context',
      'get_extraction_fulltext',
      'save_extraction_draft',
      'check_extraction_draft',
      'submit_extraction_draft',
      'finalize_extraction_consensus',
    ]);

    await client.close();
  });
});
