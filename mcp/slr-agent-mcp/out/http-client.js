import { AgentApiError, redactSecret } from './errors.js';
const MAX_RESULT_BODY_BYTES = 30 * 1024;
const TRANSIENT_STATUSES = new Set([500, 502]);
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function readString(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function retryAfterSeconds(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : 10;
}
async function readBoundedText(response, maxBytes) {
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
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done)
                break;
            total += next.value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new AgentApiError('SLR API response exceeded the configured size limit', 502, 'RESPONSE_TOO_LARGE');
            }
            chunks.push(next.value);
        }
    }
    finally {
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
function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
export class AgentApiClient {
    config;
    fetchFunction;
    constructor(config, fetchFunction = fetch) {
        this.config = config;
        this.fetchFunction = fetchFunction;
    }
    async listAssignedTasks(limit, cursor) {
        const query = new URLSearchParams({ limit: String(limit) });
        if (cursor)
            query.set('cursor', cursor);
        return this.requestJson(`/tasks?${query.toString()}`);
    }
    async getAssignedTask(taskId) {
        return this.requestJson(`/tasks/${encodeURIComponent(taskId)}`);
    }
    async getTaskFullText(taskId) {
        const response = await this.request(`/tasks/${encodeURIComponent(taskId)}/markdown`, {}, [202], 'text/markdown, application/json');
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
    async submitReviewResult(taskId, input) {
        const serialized = JSON.stringify(input);
        if (new TextEncoder().encode(serialized).byteLength > MAX_RESULT_BODY_BYTES) {
            throw new AgentApiError('Review result body must not exceed 30 KB', 400, 'REQUEST_TOO_LARGE');
        }
        return this.requestJson(`/tasks/${encodeURIComponent(taskId)}/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: serialized,
        });
    }
    async getExtractionContext(taskId) {
        return this.requestJson(`/extraction/tasks/${encodeURIComponent(taskId)}/context`);
    }
    async getExtractionFullText(taskId) {
        const response = await this.request(`/extraction/tasks/${encodeURIComponent(taskId)}/fulltext`, {}, [202], 'application/json');
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
        return body.data;
    }
    async saveExtractionDraft(input) {
        return this.requestJson(`/extraction/tasks/${encodeURIComponent(input.taskId)}/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                templateVersion: input.templateVersion, values: input.values, evidence: input.evidence, expectedVersion: input.expectedVersion,
            }) });
    }
    async checkExtractionDraft(taskId) {
        return this.requestJson(`/extraction/tasks/${encodeURIComponent(taskId)}/check`, { method: 'POST' });
    }
    async createExtractionSubmitChallenge(taskId) {
        return this.requestJson(`/extraction/tasks/${encodeURIComponent(taskId)}/submit-challenge`, { method: 'POST' });
    }
    async submitExtraction(taskId, challengeId, payloadDigest) {
        return this.requestJson(`/extraction/tasks/${encodeURIComponent(taskId)}/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeId, payloadDigest, idempotencyKey: `mcp-extraction-${taskId}-${payloadDigest}` }),
        });
    }
    async createConsensusChallenge(input) {
        return this.requestJson(`/extraction/tasks/${encodeURIComponent(input.taskId)}/consensus-challenge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                expectedVersion: input.expectedVersion, values: input.values, findings: input.findings,
            }),
        });
    }
    async submitConsensusProposal(taskId, challengeId, payloadDigest) {
        return this.requestJson(`/extraction/tasks/${encodeURIComponent(taskId)}/consensus-proposal`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challengeId, payloadDigest, idempotencyKey: `mcp-consensus-${taskId}-${payloadDigest}` }),
        });
    }
    async requestJson(path, init = {}) {
        const response = await this.request(path, init, [], 'application/json');
        const body = await this.readJson(response);
        if (!isRecord(body) || body.success !== true || !('data' in body)) {
            throw new AgentApiError('Backend returned an invalid success envelope', 502, 'INVALID_RESPONSE');
        }
        return body.data;
    }
    async request(path, init, acceptedStatuses = [], accept = 'application/json') {
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
            }
            catch (error) {
                if (error instanceof AgentApiError)
                    throw error;
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new AgentApiError('SLR API request timed out', 504, 'REQUEST_TIMEOUT');
                }
                if (error instanceof TypeError) {
                    throw new AgentApiError('Unable to connect to the SLR API', 502, 'API_UNREACHABLE');
                }
                throw error;
            }
            finally {
                clearTimeout(timeout);
            }
        }
    }
    async apiError(response) {
        const body = await this.readJson(response).catch(() => undefined);
        const apiMessage = isRecord(body) && isRecord(body.error) ? readString(body.error.message) : undefined;
        const fallback = `SLR API request failed with HTTP ${response.status}`;
        const message = redactSecret(apiMessage || fallback, this.config.agentToken);
        const rawCode = isRecord(body) && isRecord(body.error) ? readString(body.error.code) : undefined;
        const code = rawCode && !rawCode.includes(this.config.agentToken) && /^[A-Za-z0-9_:-]{1,64}$/.test(rawCode)
            ? rawCode
            : undefined;
        return new AgentApiError(message, response.status, code || `HTTP_${response.status}`, response.status === 202 ? retryAfterSeconds(response.headers.get('retry-after')) : undefined);
    }
    async readJson(response) {
        const text = await readBoundedText(response, this.config.maxJsonResponseBytes);
        if (!text)
            return undefined;
        try {
            return JSON.parse(text);
        }
        catch {
            throw new AgentApiError('SLR API returned invalid JSON', 502, 'INVALID_JSON');
        }
    }
}
//# sourceMappingURL=http-client.js.map