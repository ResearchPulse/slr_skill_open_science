import { describe, expect, it } from 'vitest';
import { AgentApiClient } from '../src/http-client.js';
import { AgentApiError } from '../src/errors.js';
import type { McpConfig } from '../src/config.js';

const config: McpConfig = {
  apiBaseUrl: 'https://slr.example.test/api',
  agentToken: 'slrp_test_secret',
  timeoutMs: 5_000,
};

describe('AgentApiClient', () => {
  it('sends the project token and preserves task pagination', async () => {
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;
    const client = new AgentApiClient(config, async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        success: true,
        data: { project: { id: 'p1' }, items: [], nextCursor: 'cursor-2', hasMore: true },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const page = await client.listAssignedTasks(25, 'cursor-1');

    expect(capturedUrl).toBe('https://slr.example.test/api/agent/v1/tasks?limit=25&cursor=cursor-1');
    expect(capturedHeaders?.get('authorization')).toBe('Bearer slrp_test_secret');
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.hasMore).toBe(true);
  });

  it('returns pending full text with the server retry delay', async () => {
    let capturedHeaders: Headers | undefined;
    const client = new AgentApiClient(config, async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
      success: true,
      data: { status: 'PROCESSING' },
      }), { status: 202, headers: { 'Retry-After': '12' } });
    });

    await expect(client.getTaskFullText('task-1')).resolves.toEqual({
      kind: 'pending',
      status: 'PROCESSING',
      retryAfterSeconds: 12,
    });
    expect(capturedHeaders?.get('accept')).toBe('text/markdown, application/json');
  });

  it('accepts markdown full text and JSON processing responses', async () => {
    let capturedHeaders: Headers | undefined;
    const client = new AgentApiClient(config, async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('# Review text', { status: 200, headers: { 'content-type': 'text/markdown' } });
    });

    await expect(client.getTaskFullText('task-1')).resolves.toEqual({ kind: 'ready', markdown: '# Review text' });
    expect(capturedHeaders?.get('accept')).toBe('text/markdown, application/json');
  });

  it('redacts the project token from API errors', async () => {
    const client = new AgentApiClient(config, async () => new Response(JSON.stringify({
      success: false,
      error: { code: `ERR_${config.agentToken}`, message: `invalid ${config.agentToken}` },
    }), { status: 401, headers: { 'content-type': 'application/json' } }));

    try {
      await client.listAssignedTasks(1);
      throw new Error('Expected the request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentApiError);
      if (error instanceof AgentApiError) {
        expect(error.status).toBe(401);
        expect(error.message).not.toContain(config.agentToken);
        expect(error.code).not.toContain(config.agentToken);
        expect(error.code).toBe('HTTP_401');
      }
    }
  });

  it('does not retry a review POST after a transient backend failure', async () => {
    let requestCount = 0;
    const client = new AgentApiClient(config, async (_input, init) => {
      requestCount += 1;
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ success: false, error: { code: 'TEMPORARY', message: 'try again' } }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(client.submitReviewResult('task-1', { decision: 'INCLUDE', reasoning: 'evidence' }))
      .rejects.toMatchObject({ status: 502 });
    expect(requestCount).toBe(1);
  });

  it('rejects an oversized review body before making a request', async () => {
    let requestCount = 0;
    const client = new AgentApiClient(config, async () => {
      requestCount += 1;
      return new Response('{}', { status: 200 });
    });

    await expect(client.submitReviewResult('task-1', {
      decision: 'INCLUDE',
      reasoning: 'x'.repeat(31_000),
    })).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    expect(requestCount).toBe(0);
  });
});
