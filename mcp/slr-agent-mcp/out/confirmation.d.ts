import type { McpConfig } from './config.js';
import type { SubmitReviewInput } from './types.js';
export interface ConfirmationPayload {
    profileId: string;
    projectId: string;
    taskId: string;
    decision: string;
    reasoning: string;
    data?: Record<string, unknown>;
}
export declare function buildConfirmationPayload(config: McpConfig, taskId: string, input: SubmitReviewInput): ConfirmationPayload;
export declare function confirmationDigest(payload: ConfirmationPayload): string;
//# sourceMappingURL=confirmation.d.ts.map