import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { AgentApiClient } from '../src/http-client.js';
import { createServer } from '../src/server.js';
import { buildConfirmationPayload, confirmationDigest } from '../src/confirmation.js';
import type { McpConfig } from '../src/config.js';

const config: McpConfig = {
  apiBaseUrl: 'https://slr.example.test/api',
  agentToken: 'slrp_test_secret',
  timeoutMs: 5_000,
  profileId: 'test-profile',
  projectId: 'project-1',
  projectName: 'Test project',
  maxJsonResponseBytes: 1_024 * 1_024,
  maxMarkdownResponseBytes: 8 * 1_024 * 1_024,
};

async function connectPair(client: Client, server: ReturnType<typeof createServer>): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

const reviewInput = {
  decision: 'INCLUDE',
  reasoning: 'The criteria match.',
};

function reviewArguments(confirmation?: { confirm: boolean; digest: string }): Record<string, unknown> {
  return {
    taskId: 'task-1',
    ...reviewInput,
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

describe('SLR MCP server', () => {
  it('exposes exactly the four contract tools', async () => {
    const server = createServer(config);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await connectPair(client, server);

    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name)).toEqual([
      'list_assigned_tasks',
      'get_assigned_task',
      'get_task_fulltext',
      'submit_review_result',
    ]);

    await client.close();
    await server.close();
  });

  it('routes the read-only list tool and redacts a token echoed by backend content', async () => {
    const fetchFunction: typeof fetch = async () => new Response(JSON.stringify({
      success: true,
      data: { items: [{ id: 'task-1', title: `untrusted-${config.agentToken}` }], nextCursor: null, hasMore: false },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const server = createServer(config, new AgentApiClient(config, fetchFunction));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await connectPair(client, server);

    const result = await client.callTool({ name: 'list_assigned_tasks', arguments: { limit: 1 } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).not.toContain(config.agentToken);
    expect(JSON.stringify(result)).toContain('[redacted]');
    await client.close();
    await server.close();
  });

  it('does not POST on the first call and supports an explicit cancellation', async () => {
    let submitCount = 0;
    const fetchFunction: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST') submitCount += 1;
      return new Response(JSON.stringify({ success: true, data: { id: 'task-1', status: 'COMPLETED' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const server = createServer(config, new AgentApiClient(config, fetchFunction));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await connectPair(client, server);

    const pending = await client.callTool({ name: 'submit_review_result', arguments: reviewArguments() });

    expect(submitCount).toBe(0);
    expect(JSON.stringify(pending)).toContain('CONFIRMATION_REQUIRED');

    const cancelled = await client.callTool({
      name: 'submit_review_result',
      arguments: reviewArguments({ confirm: false, digest: '0'.repeat(64) }),
    });

    expect(submitCount).toBe(0);
    expect(JSON.stringify(cancelled)).toContain('CANCELLED');
    await client.close();
    await server.close();
  });

  it('posts exactly once only after the matching second confirmation call', async () => {
    let submitCount = 0;
    const fetchFunction: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST') submitCount += 1;
      return new Response(JSON.stringify({ success: true, data: { id: 'task-1', status: 'COMPLETED' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const server = createServer(config, new AgentApiClient(config, fetchFunction));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const digest = confirmationDigest(buildConfirmationPayload(config, 'task-1', reviewInput));
    await connectPair(client, server);

    const pending = await client.callTool({ name: 'submit_review_result', arguments: reviewArguments() });
    expect(JSON.stringify(pending)).toContain(digest);

    const result = await client.callTool({
      name: 'submit_review_result',
      arguments: reviewArguments({ confirm: true, digest }),
    });

    expect(submitCount).toBe(1);
    expect(JSON.stringify(result)).toContain('COMPLETED');
    await client.close();
    await server.close();
  });

  it('does not POST when the confirmation digest mismatches', async () => {
    let submitCount = 0;
    const fetchFunction: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST') submitCount += 1;
      return new Response(JSON.stringify({ success: true, data: { id: 'task-1', status: 'COMPLETED' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const server = createServer(config, new AgentApiClient(config, fetchFunction));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await connectPair(client, server);

    const result = await client.callTool({
      name: 'submit_review_result',
      arguments: reviewArguments({ confirm: true, digest: '0'.repeat(64) }),
    });

    expect(submitCount).toBe(0);
    expect(JSON.stringify(result)).toContain('CONFIRMATION_MISMATCH');
    await client.close();
    await server.close();
  });

});
