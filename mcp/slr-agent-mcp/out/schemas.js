import * as z from 'zod/v4';
export const listAssignedTasksSchema = z.object({
    limit: z.number().int().min(1).max(100).default(50).describe('Maximum tasks to return, from 1 to 100.'),
    cursor: z.string().trim().min(1).max(2000).optional().describe('Opaque cursor returned by the previous page.'),
}).strict();
export const taskIdSchema = z.object({
    taskId: z.string().trim().min(1).max(160).describe('Task identifier returned by list_assigned_tasks.'),
}).strict();
export const fullTextRequestSchema = z.object({
    taskId: z.string().trim().min(1).max(160).describe('Assigned task identifier.'),
    stage: z.literal('FULL_TEXT').describe('Must be the task stage returned by get_assigned_task.'),
    markdownPath: z.string().trim().min(1).max(2000).describe('Must be the markdownPath returned by get_assigned_task.'),
}).strict();
export const submitReviewResultSchema = z.object({
    taskId: z.string().trim().min(1).max(160).describe('Assigned task identifier.'),
    decision: z.string().trim().min(1).max(100).describe('Screening decision, commonly INCLUDE, EXCLUDE, or UNCERTAIN.'),
    reasoning: z.string().trim().min(1).max(16_000).describe('Evidence-based reasoning for the decision.'),
    data: z.record(z.string(), z.unknown()).optional().describe('Optional structured review fields.'),
    confirmation: z.object({
        confirm: z.boolean().describe('Set true only after the user confirms the exact payload and digest.'),
        digest: z.string().regex(/^[a-f0-9]{64}$/).describe('SHA-256 digest returned by the first confirmation step.'),
    }).strict().optional().describe('Required on the second call when the host does not support MCP elicitation.'),
}).strict();
const extractionEvidenceSchema = z.object({
    fieldId: z.string().trim().min(1),
    sourceAssetId: z.string().trim().min(1),
    sourceRevision: z.string().trim().min(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(1),
    quote: z.string().trim().min(1).max(4000),
    quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
    section: z.string().trim().max(500).optional(),
    paragraph: z.number().int().min(0).optional(),
    pdfPage: z.number().int().min(1).optional(),
}).strict();
export const saveExtractionDraftSchema = z.object({
    taskId: z.string().trim().min(1).max(160),
    templateVersion: z.number().int().min(1),
    values: z.record(z.string(), z.unknown()),
    evidence: z.array(extractionEvidenceSchema).max(500).default([]),
    expectedVersion: z.number().int().min(0),
}).strict();
export const extractionTaskIdSchema = taskIdSchema;
export const submitExtractionSchema = z.object({
    taskId: z.string().trim().min(1).max(160),
    confirmation: z.object({
        confirm: z.boolean(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict().optional(),
}).strict();
export const consensusProposalSchema = z.object({
    taskId: z.string().trim().min(1).max(160),
    expectedVersion: z.number().int().min(0),
    values: z.record(z.string(), z.unknown()),
    findings: z.array(z.object({
        findingId: z.string().trim().min(1),
        fieldId: z.string().trim().min(1),
        kind: z.enum(['VALUE_DISAGREEMENT', 'MISSING_REQUIRED', 'AI_SUGGESTION']),
        status: z.enum(['PENDING', 'RESOLVED', 'DISMISSED']),
        reviewer1Value: z.unknown().optional(),
        reviewer2Value: z.unknown().optional(),
        proposedValue: z.unknown().optional(),
        resolution: z.unknown().optional(),
        reason: z.string().optional(),
    }).strict()).max(500),
    confirmation: z.object({
        confirm: z.boolean(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict().optional(),
}).strict();
//# sourceMappingURL=schemas.js.map