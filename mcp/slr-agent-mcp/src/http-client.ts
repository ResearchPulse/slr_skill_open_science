import { AgentApiError, redactSecret } from './errors.js';
import type { McpConfig } from './config.js';
import type {
  AgentApiEnvelope,
  AgentTask,
  JsonObject,
  ExtractionCheck,
  ExtractionContext,
  ExtractionFullText,
  ExtractionDraft,
  FullTextResult,
  PendingFullText,
  SubmitReviewInput,
  TaskDetail,
  TaskPage,
} from './types.js';
import type { ConsensusProposalInput, SaveExtractionDraftInput } from './schemas.js';

type FetchFunction = typeof fetch;

const MAX_RESULT_BODY_BYTES = 30 * 1024;
const TRANSIENT_STATUSES = new Set([500, 502]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function retryAfterSeconds(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : 10;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new AgentApiError('SLR API response exceeded the configured size limit', 502, 'RESPONSE_TOO_LARGE');
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new AgentApiError('SLR API response exceeded the configured size limit', 502, 'RESPONSE_TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AgentApiError('SLR API response exceeded the configured size limit', 502, 'RESPONSE_TOO_LARGE');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class AgentApiClient {
  private readonly config: McpConfig;
  private readonly fetchFunction: FetchFunction;

  constructor(config: McpConfig, fetchFunction: FetchFunction = fetch) {
    this.config = config;
    this.fetchFunction = fetchFunction;
  }

  async listAssignedTasks(limit: number, cursor?: string): Promise<TaskPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return this.requestJson<TaskPage>(`/tasks?${query.toString()}`);
  }

  async getAssignedTask(taskId: string): Promise<TaskDetail> {
    return this.requestJson<TaskDetail>(`/tasks/${encodeURIComponent(taskId)}`);
  }

  async getTaskFullText(taskId: string): Promise<FullTextResult> {
    const response = await this.request(
      `/tasks/${encodeURIComponent(taskId)}/markdown`,
      {},
      [202],
      'text/markdown, application/json',
    );
    if (response.status === 202) {
      const body = await this.readJson(response);
      const status = isRecord(body) && isRecord(body.data) ? readString(body.data.status) : undefined;
      return {
        kind: 'pending',
        status: status || 'PROCESSING',
        retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')),
      };
    }

    return { kind: 'ready', markdown: await readBoundedText(response, this.config.maxMarkdownResponseBytes) };
  }

  async submitReviewResult(taskId: string, input: SubmitReviewInput): Promise<AgentTask> {
    const serialized = JSON.stringify(input);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RESULT_BODY_BYTES) {
      throw new AgentApiError('Review result body must not exceed 30 KB', 400, 'REQUEST_TOO_LARGE');
    }

    return this.requestJson<AgentTask>(`/tasks/${encodeURIComponent(taskId)}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: serialized,
    });
  }

  async getExtractionContext(taskId: string): Promise<ExtractionContext> {
    return this.requestJson<ExtractionContext>(`/extraction/tasks/${encodeURIComponent(taskId)}/context`);
  }

  async getExtractionFullText(taskId: string): Promise<ExtractionFullText | PendingFullText> {
    const response = await this.request(
      `/extraction/tasks/${encodeURIComponent(taskId)}/fulltext`,
      {},
      [202],
      'application/json',
    );
    const body = await this.readJson(response);
    if (response.status === 202) {
      const data = isRecord(body) && isRecord(body.data) ? body.data : {};
      return {
        kind: 'pending',
        status: readString(data.status) || 'PROCESSING',
        retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')),
      };
    }
    if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
      throw new AgentApiError('Backend returned an invalid extraction full-text response', 502, 'INVALID_RESPONSE');
    }
    return body.data as unknown as ExtractionFullText;
  }

  async saveExtractionDraft(input: SaveExtractionDraftInput): Promise<{ draft: ExtractionDraft; canonicalRecordUntouched: boolean }> {
    return this.requestJson<{ draft: ExtractionDraft; canonicalRecordUntouched: boolean }>(
      `/extraction/tasks/${encodeURIComponent(input.taskId)}/draft`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        templateVersion: input.templateVersion, values: input.values, evidence: input.evidence, expectedVersion: input.expectedVersion,
      }) },
    );
  }

  async checkExtractionDraft(taskId: string): Promise<ExtractionCheck> {
    return this.requestJson<ExtractionCheck>(`/extraction/tasks/${encodeURIComponent(taskId)}/check`, { method: 'POST' });
  }

  async createExtractionSubmitChallenge(taskId: string): Promise<{ challengeId: string; payloadDigest: string; expiresAt: string; payload?: JsonObject }> {
    return this.requestJson<{ challengeId: string; payloadDigest: string; expiresAt: string; payload?: JsonObject }>(
      `/extraction/tasks/${encodeURIComponent(taskId)}/submit-challenge`, { method: 'POST' },
    );
  }

  async submitExtraction(taskId: string, challengeId: string, payloadDigest: string): Promise<JsonObject> {
    return this.requestJson<JsonObject>(`/extraction/tasks/${encodeURIComponent(taskId)}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, payloadDigest, idempotencyKey: `mcp-extraction-${taskId}-${payloadDigest}` }),
    });
  }

  async createConsensusChallenge(input: ConsensusProposalInput): Promise<{ challengeId: string; payloadDigest: string; expiresAt: string; payload?: JsonObject }> {
    return this.requestJson<{ challengeId: string; payloadDigest: string; expiresAt: string; payload?: JsonObject }>(
      `/extraction/tasks/${encodeURIComponent(input.taskId)}/consensus-challenge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          expectedVersion: input.expectedVersion, values: input.values, findings: input.findings,
        }),
      },
    );
  }

  async submitConsensusProposal(taskId: string, challengeId: string, payloadDigest: string): Promise<JsonObject> {
    return this.requestJson<JsonObject>(`/extraction/tasks/${encodeURIComponent(taskId)}/consensus-proposal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, payloadDigest, idempotencyKey: `mcp-consensus-${taskId}-${payloadDigest}` }),
    });
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init, [], 'application/json');
    const body = await this.readJson(response);
    if (!isRecord(body) || body.success !== true || !('data' in body)) {
      throw new AgentApiError('Backend returned an invalid success envelope', 502, 'INVALID_RESPONSE');
    }
    return (body as unknown as AgentApiEnvelope<T>).data;
  }

  private async request(path: string, init: RequestInit, acceptedStatuses: number[] = [], accept = 'application/json'): Promise<Response> {
    const url = `${this.config.apiBaseUrl}/agent/v1${path}`;
    const method = (init.method || 'GET').toUpperCase();
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${this.config.agentToken}`);
      headers.set('Accept', accept);

      try {
        const response = await this.fetchFunction(url, { ...init, headers, signal: controller.signal });
        if (method === 'GET' && TRANSIENT_STATUSES.has(response.status) && attempt === 0) {
          await response.body?.cancel();
          attempt += 1;
          await wait(100);
          continue;
        }
        if (!response.ok && !acceptedStatuses.includes(response.status)) {
          throw await this.apiError(response);
        }
        return response;
      } catch (error) {
        if (error instanceof AgentApiError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new AgentApiError('SLR API request timed out', 504, 'REQUEST_TIMEOUT');
        }
        if (error instanceof TypeError) {
          throw new AgentApiError('Unable to connect to the SLR API', 502, 'API_UNREACHABLE');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async apiError(response: Response): Promise<AgentApiError> {
    const body = await this.readJson(response).catch(() => undefined);
    const apiMessage = isRecord(body) && isRecord(body.error) ? readString(body.error.message) : undefined;
    const fallback = `SLR API request failed with HTTP ${response.status}`;
    const message = redactSecret(apiMessage || fallback, this.config.agentToken);
    const rawCode = isRecord(body) && isRecord(body.error) ? readString(body.error.code) : undefined;
    const code = rawCode && !rawCode.includes(this.config.agentToken) && /^[A-Za-z0-9_:-]{1,64}$/.test(rawCode)
      ? rawCode
      : undefined;
    return new AgentApiError(message, response.status, code || `HTTP_${response.status}`,
      response.status === 202 ? retryAfterSeconds(response.headers.get('retry-after')) : undefined);
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await readBoundedText(response, this.config.maxJsonResponseBytes);
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AgentApiError('SLR API returned invalid JSON', 502, 'INVALID_JSON');
    }
  }
}
