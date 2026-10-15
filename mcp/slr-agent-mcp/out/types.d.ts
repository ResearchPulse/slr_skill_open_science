export type JsonObject = Record<string, unknown>;
export type AgentTaskStatus = 'ASSIGNED' | 'COMPLETED' | string;
export type AgentTaskStage = 'TITLE_ABSTRACT' | 'FULL_TEXT' | string;
export interface ProtocolSnapshot {
    version?: string;
    capturedAt?: string;
    researchQuestions?: string[];
    inclusionCriteria?: string[];
    exclusionCriteria?: string[];
    [key: string]: unknown;
}
export type FullTextStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE' | string;
export interface ProjectContext {
    id: string;
    name: string;
    researchQuestions: string[];
    inclusionCriteria: string[];
    exclusionCriteria: string[];
}
export interface PaperAuthor {
    name?: string;
    [key: string]: unknown;
}
export interface PaperSummary {
    id: string;
    title?: string;
    abstract?: string;
    authors?: Array<string | PaperAuthor>;
    doi?: string;
    year?: number;
    journal?: string;
    source?: string;
    fullTextStatus?: FullTextStatus;
    [key: string]: unknown;
}
export interface AgentTask {
    id: string;
    agentId: string;
    projectId: string;
    projectName: string;
    paperId: string;
    stage?: AgentTaskStage;
    paperTitle?: string;
    instructions: string;
    protocolSnapshot?: ProtocolSnapshot;
    status: AgentTaskStatus;
    createdAt: string;
    createdBy: string;
    completedAt?: string;
    markdownPath?: string;
    paper?: PaperSummary;
    result?: {
        decision: string;
        reasoning: string;
        data?: JsonObject;
    };
    taskKind?: 'screening' | 'extraction' | string;
    [key: string]: unknown;
}
export interface ExtractionEvidence {
    fieldId: string;
    sourceAssetId: string;
    sourceRevision: string;
    sourceHash: string;
    startOffset: number;
    endOffset: number;
    quote: string;
    quoteHash: string;
    section?: string;
    paragraph?: number;
    pdfPage?: number;
}
export interface ExtractionDraft {
    taskId: string;
    agentId: string;
    reviewerId: string;
    projectId: string;
    paperId: string;
    templateVersion: number;
    values: JsonObject;
    evidence: ExtractionEvidence[];
    baseVersion: number;
    version: number;
    status: 'DRAFT' | 'SUBMITTED' | string;
    sourceAssetId?: string;
    sourceRevision?: string;
    sourceHash?: string;
    lastProposalId?: string;
    createdAt: string;
    updatedAt: string;
    submittedAt?: string;
}
export interface ExtractionContext {
    task: AgentTask;
    assignment: JsonObject;
    templateSnapshot: JsonObject;
    paper: PaperSummary;
    draft: ExtractionDraft | null;
}
export interface ExtractionFullText {
    status: 'COMPLETED';
    markdown: string;
    sourceAssetId: string;
    sourceRevision: string;
    sourceHash: string;
    coordinateMap: Array<{
        paragraph: number;
        startOffset: number;
        endOffset: number;
        lineStart: number;
        lineEnd: number;
    }>;
}
export interface ExtractionCheck {
    status: 'PASS' | 'WARN' | 'BLOCK' | string;
    issues: Array<{
        code: string;
        severity: 'WARN' | 'BLOCK';
        message: string;
    }>;
    draftVersion: number;
    model?: {
        status: string;
    };
    checkedAt: string;
}
export interface ExtractionConfirmation {
    confirm: boolean;
    digest: string;
}
export interface TaskPage {
    project: ProjectContext;
    items: AgentTask[];
    nextCursor: string | null;
    hasMore: boolean;
}
export interface TaskDetail {
    task: AgentTask;
    project: ProjectContext;
    paper: PaperSummary;
}
export interface FullTextRequest {
    taskId: string;
    stage: 'FULL_TEXT';
    markdownPath: string;
}
export interface SubmitReviewInput {
    decision: string;
    reasoning: string;
    data?: JsonObject;
}
export interface PendingFullText {
    kind: 'pending';
    status: string;
    retryAfterSeconds: number;
}
export interface ReadyFullText {
    kind: 'ready';
    markdown: string;
}
export type FullTextResult = PendingFullText | ReadyFullText;
export interface AgentApiEnvelope<T> {
    success: true;
    data: T;
}
//# sourceMappingURL=types.d.ts.map