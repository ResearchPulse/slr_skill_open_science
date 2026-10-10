import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { AgentApiClient } from '../src/http-client.js';
import { createServer } from '../src/server.js';
import type { McpConfig } from '../src/config.js';

const config: McpConfig = {
  apiBaseUrl: 'https://slr.example.test/api',
  agentToken: 'slrp_test_secret',
  timeoutMs: 5_000,
};

async function connectPair(client: Client, server: ReturnType<typeof createServer>): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
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

  it('does not POST a result when final confirmation is declined', async () => {
    let submitCount = 0;
    let confirmationRequest = '';
    const fetchFunction: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST') submitCount += 1;
      return new Response(JSON.stringify({ success: true, data: { id: 'task-1', status: 'COMPLETED' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const server = createServer(config, new AgentApiClient(config, fetchFunction));
    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: { elicitation: {} } },
    );
    client.setRequestHandler('elicitation/create', async request => {
      confirmationRequest = JSON.stringify(request);
      return { action: 'decline' };
    });
    await connectPair(client, server);

    const result = await client.callTool({
      name: 'submit_review_result',
      arguments: {
        taskId: config.agentToken,
        decision: 'INCLUDE',
        reasoning: `The criteria match ${config.agentToken}.`,
      },
    });

    expect(submitCount).toBe(0);
    expect(confirmationRequest).not.toContain(config.agentToken);
    expect(JSON.stringify(result)).toContain('CANCELLED');
    await client.close();
    await server.close();
  });

  it('posts exactly once only after confirmation is accepted', async () => {
    let submitCount = 0;
    const fetchFunction: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST') submitCount += 1;
      return new Response(JSON.stringify({ success: true, data: { id: 'task-1', status: 'COMPLETED' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const server = createServer(config, new AgentApiClient(config, fetchFunction));
    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: { elicitation: {} } },
    );
    client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: true } }));
    await connectPair(client, server);

    const result = await client.callTool({
      name: 'submit_review_result',
      arguments: { taskId: 'task-1', decision: 'INCLUDE', reasoning: 'The criteria match.' },
    });

    expect(submitCount).toBe(1);
    expect(JSON.stringify(result)).toContain('COMPLETED');
    await client.close();
    await server.close();
  });

  it('does not POST when confirmation content is invalid', async () => {
    let submitCount = 0;
    let elicitationCount = 0;
    const fetchFunction: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST') submitCount += 1;
      return new Response(JSON.stringify({ success: true, data: { id: 'task-1', status: 'COMPLETED' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const server = createServer(config, new AgentApiClient(config, fetchFunction));
    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: { elicitation: {} } },
    );
    client.setRequestHandler('elicitation/create', async () => {
      elicitationCount += 1;
      return elicitationCount === 1
        ? { action: 'accept', content: { confirm: false } }
        : { action: 'decline' };
    });
    await connectPair(client, server);

    const result = await client.callTool({
      name: 'submit_review_result',
      arguments: { taskId: 'task-1', decision: 'INCLUDE', reasoning: 'The criteria match.' },
    });

    expect(submitCount).toBe(0);
    expect(elicitationCount).toBe(2);
    expect(JSON.stringify(result)).toContain('CANCELLED');
    await client.close();
    await server.close();
  });
});
