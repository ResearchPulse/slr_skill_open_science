import type { McpConfig } from './config.js';
import type { AgentTask, JsonObject, ExtractionCheck, ExtractionContext, ExtractionFullText, ExtractionDraft, FullTextResult, PendingFullText, SubmitReviewInput, TaskDetail, TaskPage } from './types.js';
import type { ConsensusProposalInput, SaveExtractionDraftInput } from './schemas.js';
type FetchFunction = typeof fetch;
export declare class AgentApiClient {
    private readonly config;
    private readonly fetchFunction;
    constructor(config: McpConfig, fetchFunction?: FetchFunction);
    listAssignedTasks(limit: number, cursor?: string): Promise<TaskPage>;
    getAssignedTask(taskId: string): Promise<TaskDetail>;
    getTaskFullText(taskId: string): Promise<FullTextResult>;
    submitReviewResult(taskId: string, input: SubmitReviewInput): Promise<AgentTask>;
    getExtractionContext(taskId: string): Promise<ExtractionContext>;
    getExtractionFullText(taskId: string): Promise<ExtractionFullText | PendingFullText>;
    saveExtractionDraft(input: SaveExtractionDraftInput): Promise<{
        draft: ExtractionDraft;
        canonicalRecordUntouched: boolean;
    }>;
    checkExtractionDraft(taskId: string): Promise<ExtractionCheck>;
    createExtractionSubmitChallenge(taskId: string): Promise<{
        challengeId: string;
        payloadDigest: string;
        expiresAt: string;
        payload?: JsonObject;
    }>;
    submitExtraction(taskId: string, challengeId: string, payloadDigest: string): Promise<JsonObject>;
    createConsensusChallenge(input: ConsensusProposalInput): Promise<{
        challengeId: string;
        payloadDigest: string;
        expiresAt: string;
        payload?: JsonObject;
    }>;
    submitConsensusProposal(taskId: string, challengeId: string, payloadDigest: string): Promise<JsonObject>;
    private requestJson;
    private request;
    private apiError;
    private readJson;
}
export {};
//# sourceMappingURL=http-client.d.ts.map