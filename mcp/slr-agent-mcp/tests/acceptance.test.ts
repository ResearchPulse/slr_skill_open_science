import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConfirmationPayload, confirmationDigest } from '../src/confirmation.js';
import type { McpConfig } from '../src/config.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const serverEntry = fileURLToPath(new URL('../out/index.js', import.meta.url));
const projectToken = 'slrp_acceptance_secret';
const projectId = 'project-acceptance-001';
const profileId = 'acceptance-profile';
const taskId = 'task-acceptance-001';

const task = {
  id: taskId,
  agentId: 'agent-acceptance-001',
  projectId,
  projectName: 'Acceptance project',
  paperId: 'paper-acceptance-001',
  paperTitle: 'A deterministic MCP acceptance paper',
  instructions: 'Apply the configured inclusion criteria.',
  status: 'ASSIGNED',
  createdAt: '2026-10-11T00:00:00.000Z',
  createdBy: 'acceptance-harness',
};

const project = {
  id: projectId,
  name: 'Acceptance project',
  researchQuestions: ['Does the paper satisfy the review question?'],
  inclusionCriteria: ['IC1: The paper reports an empirical result.'],
  exclusionCriteria: ['EC1: The paper is not a research study.'],
};

const paper = {
  id: 'paper-acceptance-001',
  title: task.paperTitle,
  abstract: 'A fixed abstract used only by the local acceptance harness.',
  authors: ['Harness Author'],
  year: 2026,
  journal: 'Harness Journal',
  fullTextStatus: 'COMPLETED',
};

interface RequestLog {
  method: string;
  path: string;
  authorization: string | undefined;
  body?: unknown;
}

interface HarnessApi {
  baseUrl: string;
  requests: RequestLog[];
  postRequests: RequestLog[];
  close: () => Promise<void>;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function startHarnessApi(): Promise<HarnessApi> {
  const requests: RequestLog[] = [];
  const postRequests: RequestLog[] = [];
  let fullTextRequests = 0;

  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    const log: RequestLog = {
      method: request.method || 'GET',
      path: url.pathname,
      authorization: request.headers.authorization,
    };

    try {
      if (request.method === 'POST') {
        const bodyText = await readBody(request);
        log.body = bodyText ? JSON.parse(bodyText) : undefined;
        requests.push(log);
        postRequests.push(log);
        if (postRequests.length > 1) {
          writeJson(response, 409, {
            success: false,
            error: { code: 'TASK_COMPLETED', message: 'The task has already been completed.' },
          });
          return;
        }
        writeJson(response, 200, {
          success: true,
          data: { ...task, status: 'COMPLETED', completedAt: '2026-10-11T00:01:00.000Z' },
        });
        return;
      }

      requests.push(log);
      if (url.pathname === '/api/agent/v1/tasks') {
        writeJson(response, 200, {
          success: true,
          data: { project, items: [task], nextCursor: null, hasMore: false },
        });
        return;
      }
      if (url.pathname === `/api/agent/v1/tasks/${taskId}`) {
        writeJson(response, 200, { success: true, data: { task, project, paper } });
        return;
      }
      if (url.pathname === `/api/agent/v1/tasks/${taskId}/markdown`) {
        fullTextRequests += 1;
        if (fullTextRequests === 1) {
          response.writeHead(202, { 'content-type': 'application/json', 'retry-after': '1' });
          response.end(JSON.stringify({ success: true, data: { status: 'PROCESSING' } }));
          return;
        }
        response.writeHead(200, { 'content-type': 'text/markdown' });
        response.end(`# ${paper.title}\n\nThe fixed full text is ready for review.`);
        return;
      }
      writeJson(response, 404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    } catch {
      writeJson(response, 400, { success: false, error: { code: 'BAD_REQUEST', message: 'Bad request' } });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Harness API did not expose a TCP port');

  return {
    baseUrl: `http://127.0.0.1:${address.port}/api`,
    requests,
    postRequests,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function buildMcpConfig(api: HarnessApi): McpConfig {
  return {
    apiBaseUrl: api.baseUrl,
    agentToken: projectToken,
    timeoutMs: 5_000,
    profileId,
    projectId,
    projectName: project.name,
    allowedHosts: [],
    maxJsonResponseBytes: 1_024 * 1_024,
    maxMarkdownResponseBytes: 8 * 1_024 * 1_024,
  };
}

function submitReview(
  client: Client,
  taskId: string,
  input: Record<string, unknown>,
  confirmation?: { confirm: boolean; digest: string },
) {
  return client.callTool({
    name: 'submit_review_result',
    arguments: {
      taskId,
      ...input,
      ...(confirmation === undefined ? {} : { confirmation }),
    },
  });
}

async function closeClient(client: Client | undefined): Promise<void> {
  if (client) await client.close();
}

describe('SLR MCP acceptance harness', () => {
  let api: HarnessApi | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await closeClient(client);
    client = undefined;
    if (api) await api.close();
    api = undefined;
  });

  it('runs the five-tool workflow through a real stdio process and fake API', async () => {
    api = await startHarnessApi();
    const config = buildMcpConfig(api);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: packageRoot,
      env: {
        ...process.env,
        SLR_API_BASE_URL: api.baseUrl,
        SLR_AGENT_TOKEN: projectToken,
        SLR_PROFILE_ID: profileId,
        SLR_PROJECT_ID: projectId,
        SLR_PROJECT_NAME: project.name,
        SLR_REQUEST_TIMEOUT_MS: '5000',
      },
      stderr: 'pipe',
    });
    const connectedClient = new Client({ name: 'slr-acceptance-harness', version: '1.0.0' });
    client = connectedClient;
    const input = {
      decision: 'INCLUDE',
      reasoning: 'The fixed paper satisfies IC1 based on the reported empirical result.',
      data: { confidence: 0.95, evidence: ['abstract', 'full text'] },
    };
    const digest = confirmationDigest(buildConfirmationPayload(config, taskId, input));

    await connectedClient.connect(transport);

    const tools = await connectedClient.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual([
      'list_assigned_tasks',
      'connection_test',
      'get_assigned_task',
      'get_task_fulltext',
      'submit_review_result',
    ]);

    const listResult = await connectedClient.callTool({ name: 'list_assigned_tasks', arguments: { limit: 1 } });
    expect(listResult.isError).not.toBe(true);
    expect(JSON.stringify(listResult)).toContain(taskId);

    const detailResult = await connectedClient.callTool({ name: 'get_assigned_task', arguments: { taskId } });
    expect(detailResult.isError).not.toBe(true);
    expect(JSON.stringify(detailResult)).toContain(paper.title);

    const pendingResult = await connectedClient.callTool({ name: 'get_task_fulltext', arguments: { taskId } });
    expect(pendingResult.isError).not.toBe(true);
    expect(JSON.stringify(pendingResult)).toContain('retryAfterSeconds');

    const fullTextResult = await connectedClient.callTool({ name: 'get_task_fulltext', arguments: { taskId } });
    expect(fullTextResult.isError).not.toBe(true);
    expect(JSON.stringify(fullTextResult)).toContain('full text is ready');

    const pending = await submitReview(connectedClient, taskId, input);
    expect(pending.isError).not.toBe(true);
    expect(JSON.stringify(pending)).toContain('CONFIRMATION_REQUIRED');
    expect(JSON.stringify(pending)).toContain(digest);
    expect(api.postRequests).toHaveLength(0);

    const declined = await submitReview(connectedClient, taskId, input, { confirm: false, digest });
    expect(declined.isError).not.toBe(true);
    expect(JSON.stringify(declined)).toContain('CANCELLED');
    expect(api.postRequests).toHaveLength(0);

    const accepted = await submitReview(connectedClient, taskId, input, { confirm: true, digest });
    expect(accepted.isError).not.toBe(true);
    expect(JSON.stringify(accepted)).toContain('COMPLETED');
    expect(api.postRequests).toHaveLength(1);
    expect(api.postRequests[0].authorization).toBe(`Bearer ${projectToken}`);
    expect(api.postRequests[0].body).toEqual(input);

    const duplicate = await submitReview(connectedClient, taskId, input, { confirm: true, digest });
    expect(duplicate.isError).toBe(true);
    const duplicateText = duplicate.content[0]?.type === 'text' ? duplicate.content[0].text : '';
    expect(duplicateText).toContain('TASK_COMPLETED');
    expect(duplicateText).toContain('"status":409');
    expect(api.postRequests).toHaveLength(2);

    expect(JSON.stringify(listResult)).not.toContain(projectToken);
    expect(JSON.stringify(detailResult)).not.toContain(projectToken);
    expect(JSON.stringify(fullTextResult)).not.toContain(projectToken);
    expect(JSON.stringify(accepted)).not.toContain(projectToken);
    expect(api.requests.filter(request => request.method === 'GET').every(request => request.authorization === `Bearer ${projectToken}`)).toBe(true);
  }, 20_000);
});
