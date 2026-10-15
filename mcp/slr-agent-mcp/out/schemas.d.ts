import * as z from 'zod/v4';
export declare const listAssignedTasksSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const taskIdSchema: z.ZodObject<{
    taskId: z.ZodString;
}, z.core.$strict>;
export declare const fullTextRequestSchema: z.ZodObject<{
    taskId: z.ZodString;
    stage: z.ZodLiteral<"FULL_TEXT">;
    markdownPath: z.ZodString;
}, z.core.$strict>;
export declare const submitReviewResultSchema: z.ZodObject<{
    taskId: z.ZodString;
    decision: z.ZodString;
    reasoning: z.ZodString;
    data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    confirmation: z.ZodOptional<z.ZodObject<{
        confirm: z.ZodBoolean;
        digest: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ListAssignedTasksInput = z.infer<typeof listAssignedTasksSchema>;
export type TaskIdInput = z.infer<typeof taskIdSchema>;
export type SubmitReviewResultInput = z.infer<typeof submitReviewResultSchema>;
export declare const saveExtractionDraftSchema: z.ZodObject<{
    taskId: z.ZodString;
    templateVersion: z.ZodNumber;
    values: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
        fieldId: z.ZodString;
        sourceAssetId: z.ZodString;
        sourceRevision: z.ZodString;
        sourceHash: z.ZodString;
        startOffset: z.ZodNumber;
        endOffset: z.ZodNumber;
        quote: z.ZodString;
        quoteHash: z.ZodString;
        section: z.ZodOptional<z.ZodString>;
        paragraph: z.ZodOptional<z.ZodNumber>;
        pdfPage: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>;
export declare const extractionTaskIdSchema: z.ZodObject<{
    taskId: z.ZodString;
}, z.core.$strict>;
export declare const submitExtractionSchema: z.ZodObject<{
    taskId: z.ZodString;
    confirmation: z.ZodOptional<z.ZodObject<{
        confirm: z.ZodBoolean;
        digest: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const consensusProposalSchema: z.ZodObject<{
    taskId: z.ZodString;
    expectedVersion: z.ZodNumber;
    values: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    findings: z.ZodArray<z.ZodObject<{
        findingId: z.ZodString;
        fieldId: z.ZodString;
        kind: z.ZodEnum<{
            VALUE_DISAGREEMENT: "VALUE_DISAGREEMENT";
            MISSING_REQUIRED: "MISSING_REQUIRED";
            AI_SUGGESTION: "AI_SUGGESTION";
        }>;
        status: z.ZodEnum<{
            PENDING: "PENDING";
            RESOLVED: "RESOLVED";
            DISMISSED: "DISMISSED";
        }>;
        reviewer1Value: z.ZodOptional<z.ZodUnknown>;
        reviewer2Value: z.ZodOptional<z.ZodUnknown>;
        proposedValue: z.ZodOptional<z.ZodUnknown>;
        resolution: z.ZodOptional<z.ZodUnknown>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    confirmation: z.ZodOptional<z.ZodObject<{
        confirm: z.ZodBoolean;
        digest: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SaveExtractionDraftInput = z.infer<typeof saveExtractionDraftSchema>;
export type SubmitExtractionInput = z.infer<typeof submitExtractionSchema>;
export type ConsensusProposalInput = z.infer<typeof consensusProposalSchema>;
//# sourceMappingURL=schemas.d.ts.map