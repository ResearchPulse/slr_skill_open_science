import { AgentApiError, redactSecret, toolError } from './errors.js';
import { buildConfirmationPayload, confirmationDigest } from './confirmation.js';
import { listAssignedTasksSchema, fullTextRequestSchema, consensusProposalSchema, saveExtractionDraftSchema, submitReviewResultSchema, submitExtractionSchema, taskIdSchema, } from './schemas.js';
import * as z from 'zod/v4';
function jsonResult(value, secret) {
    return { content: [{ type: 'text', text: redactSecret(JSON.stringify(value), secret) }] };
}
function markdownResult(markdown, secret) {
    return { content: [{ type: 'text', text: redactSecret(markdown, secret) }] };
}
function safeDisplay(value, max = 500) {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function safeSecretDisplay(value, secret, max = 500) {
    return safeDisplay(redactSecret(value, secret), max);
}
function confirmationMessage(taskId, input, config, digest) {
    const reasoningPreview = input.reasoning.length > 500 ? `${input.reasoning.slice(0, 500)}…` : input.reasoning;
    return [
        'Final confirmation required before writing an SLR review result.',
        `Profile: ${safeSecretDisplay(config.profileId, config.agentToken, 100)}`,
        `Project: ${safeSecretDisplay(config.projectName, config.agentToken, 160)} (${safeSecretDisplay(config.projectId, config.agentToken, 160)})`,
        `Task: ${safeSecretDisplay(taskId, config.agentToken, 160)}`,
        `Decision: ${safeSecretDisplay(input.decision, config.agentToken, 100)}`,
        `Reason/comment preview (untrusted model text): ${safeSecretDisplay(reasoningPreview, config.agentToken)}`,
        `Payload digest: ${digest}`,
        'No backend write has happened yet.',
        'After the user confirms this exact payload, call submit_review_result again with confirmation.confirm=true and this digest.',
    ].join('\n');
}
function confirmationRequiredResult(taskId, input, config, digest) {
    return jsonResult({
        status: 'CONFIRMATION_REQUIRED',
        taskId,
        digest,
        message: confirmationMessage(taskId, input, config, digest),
        nextCall: {
            confirmation: { confirm: true, digest },
            requirement: 'Repeat the exact taskId, decision, reasoning, and data only after explicit user confirmation.',
        },
    }, config.agentToken);
}
export function registerAgentTools(server, client, config) {
    const extractionChallenges = new Map();
    const consensusChallenges = new Map();
    server.registerTool('list_assigned_tasks', {
        title: 'List Assigned SLR Tasks',
        description: 'List review tasks assigned to this project-scoped SLR agent token. Process only ASSIGNED tasks. Pass nextCursor as cursor to continue pagination.',
        inputSchema: listAssignedTasksSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ limit, cursor }) => {
        try {
            return jsonResult(await client.listAssignedTasks(limit, cursor), config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('connection_test', {
        title: 'Test SLR API Connection',
        description: 'Check the project-scoped connector with one bounded read-only task request. Returns project metadata and whether assigned tasks are visible.',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async () => {
        try {
            const page = await client.listAssignedTasks(1);
            return jsonResult({
                connected: true,
                project: page.project?.name,
                projectId: page.project?.id,
                assignedTasksVisible: page.items.length > 0,
                sampleCount: page.items.length,
                hasMore: page.hasMore,
            }, config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('get_assigned_task', {
        title: 'Get Assigned SLR Task',
        description: 'Get one project-scoped assigned task with its project criteria, instructions, and paper metadata.',
        inputSchema: taskIdSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ taskId }) => {
        try {
            return jsonResult(await client.getAssignedTask(taskId), config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('get_task_fulltext', {
        title: 'Get SLR Task Full Text',
        description: 'Retrieve paper Markdown only for a task whose get_assigned_task response has stage FULL_TEXT and a markdownPath. Pass both returned values. If extraction is pending, return retryAfterSeconds and do not poll repeatedly inside this call. A 409 FULLTEXT_STAGE_REQUIRED is terminal for this call and must not be retried.',
        inputSchema: fullTextRequestSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ taskId, stage, markdownPath }) => {
        try {
            if (stage !== 'FULL_TEXT' || !markdownPath.trim()) {
                return toolError(new AgentApiError('Markdown is available only for FULL_TEXT tasks that include markdownPath', 409, 'FULLTEXT_STAGE_REQUIRED'), config.agentToken);
            }
            const result = await client.getTaskFullText(taskId);
            return result.kind === 'ready' ? markdownResult(result.markdown, config.agentToken) : jsonResult(result, config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('submit_review_result', {
        title: 'Submit SLR Review Result',
        description: 'Write one review result and complete the assigned task. This changes project state. The first call returns a payload digest without writing; only a second call with confirmation.confirm=true and the matching digest can send the backend POST.',
        inputSchema: submitReviewResultSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async ({ taskId, decision, reasoning, data, confirmation }) => {
        const input = {
            decision,
            reasoning,
            ...(data === undefined ? {} : { data }),
        };
        const digest = confirmationDigest(buildConfirmationPayload(config, taskId, input));
        if (!confirmation) {
            return confirmationRequiredResult(taskId, input, config, digest);
        }
        if (!confirmation.confirm) {
            return jsonResult({ status: 'CANCELLED', message: 'Submission cancelled; no review result was written.' }, config.agentToken);
        }
        if (confirmation.digest !== digest) {
            return toolError(new AgentApiError('Confirmation does not match the current review payload', 409, 'CONFIRMATION_MISMATCH'), config.agentToken);
        }
        try {
            return jsonResult(await client.submitReviewResult(taskId, input), config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('get_extraction_context', {
        title: 'Get Extraction Context',
        description: 'Read one assigned extraction task, its immutable template snapshot, paper metadata, and the isolated agent draft.',
        inputSchema: taskIdSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ taskId }) => {
        try {
            return jsonResult(await client.getExtractionContext(taskId), config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('get_extraction_fulltext', {
        title: 'Get Extraction Full Text',
        description: 'Read normalized Markdown plus source hash, revision, and evidence coordinate metadata for an extraction task.',
        inputSchema: taskIdSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ taskId }) => {
        try {
            const result = await client.getExtractionFullText(taskId);
            return jsonResult(result, config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('save_extraction_draft', {
        title: 'Save Extraction Draft',
        description: 'Save field values and bounded evidence coordinates to the isolated agent draft. This does not submit or modify the canonical reviewer record.',
        inputSchema: saveExtractionDraftSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (input) => {
        try {
            return jsonResult(await client.saveExtractionDraft(input), config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('check_extraction_draft', {
        title: 'Check Extraction Draft',
        description: 'Run deterministic value and evidence validation on the current isolated extraction draft. No canonical write occurs.',
        inputSchema: taskIdSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ taskId }) => {
        try {
            return jsonResult(await client.checkExtractionDraft(taskId), config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('submit_extraction_draft', {
        title: 'Submit Extraction',
        description: 'Submit the exact extraction draft after one explicit user confirmation. The backend challenge and idempotency handshake is handled inside this tool.',
        inputSchema: submitExtractionSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async ({ taskId, confirmation }) => {
        try {
            if (!confirmation) {
                const challenge = await client.createExtractionSubmitChallenge(taskId);
                extractionChallenges.set(`${taskId}:${challenge.payloadDigest}`, challenge);
                return jsonResult({
                    status: 'CONFIRMATION_REQUIRED', taskId, payloadDigest: challenge.payloadDigest, expiresAt: challenge.expiresAt,
                    draft: challenge.payload, message: 'Review this exact field-value and evidence draft. Reply confirm or cancel once.',
                }, config.agentToken);
            }
            if (!confirmation.confirm) {
                extractionChallenges.delete(`${taskId}:${confirmation.digest}`);
                return jsonResult({ status: 'CANCELLED', message: 'Extraction submission cancelled; no proposal was written.' }, config.agentToken);
            }
            const challenge = extractionChallenges.get(`${taskId}:${confirmation.digest}`);
            if (!challenge)
                return toolError(new AgentApiError('Extraction confirmation is missing or expired; prepare a new confirmation.', 409, 'CONFIRMATION_NOT_FOUND'), config.agentToken);
            const result = await client.submitExtraction(taskId, challenge.challengeId, confirmation.digest);
            extractionChallenges.delete(`${taskId}:${confirmation.digest}`);
            return jsonResult(result, config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
    server.registerTool('finalize_extraction_consensus', {
        title: 'Propose Extraction Consensus',
        description: 'Create or update the leader consensus proposal after one explicit confirmation. Final consensus completion remains a separate human-gated operation.',
        inputSchema: consensusProposalSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async (input) => {
        const proposal = input;
        try {
            if (!proposal.confirmation) {
                const challenge = await client.createConsensusChallenge(proposal);
                consensusChallenges.set(`${proposal.taskId}:${challenge.payloadDigest}`, challenge);
                return jsonResult({ status: 'CONFIRMATION_REQUIRED', taskId: proposal.taskId, payloadDigest: challenge.payloadDigest, expiresAt: challenge.expiresAt, proposal: challenge.payload, message: 'Review the exact consensus proposal. Reply confirm or cancel once.' }, config.agentToken);
            }
            if (!proposal.confirmation.confirm) {
                consensusChallenges.delete(`${proposal.taskId}:${proposal.confirmation.digest}`);
                return jsonResult({ status: 'CANCELLED', message: 'Consensus proposal cancelled; no proposal was written.' }, config.agentToken);
            }
            const challenge = consensusChallenges.get(`${proposal.taskId}:${proposal.confirmation.digest}`);
            if (!challenge)
                return toolError(new AgentApiError('Consensus confirmation is missing or expired; prepare a new confirmation.', 409, 'CONFIRMATION_NOT_FOUND'), config.agentToken);
            const expectedPayload = challenge.payload && {
                taskId: proposal.taskId,
                expectedVersion: proposal.expectedVersion,
                templateId: challenge.payload.templateId,
                templateVersion: challenge.payload.templateVersion,
                sourceAssetId: challenge.payload.sourceAssetId,
                sourceRevision: challenge.payload.sourceRevision,
                sourceHash: challenge.payload.sourceHash,
                values: proposal.values,
                findings: proposal.findings,
            };
            if (challenge.payload && JSON.stringify(challenge.payload) !== JSON.stringify(expectedPayload)) {
                return toolError(new AgentApiError('Consensus confirmation does not match the displayed proposal', 409, 'CONFIRMATION_MISMATCH'), config.agentToken);
            }
            const result = await client.submitConsensusProposal(proposal.taskId, challenge.challengeId, proposal.confirmation.digest);
            consensusChallenges.delete(`${proposal.taskId}:${proposal.confirmation.digest}`);
            return jsonResult(result, config.agentToken);
        }
        catch (error) {
            return toolError(error, config.agentToken);
        }
    });
}
//# sourceMappingURL=tools.js.map