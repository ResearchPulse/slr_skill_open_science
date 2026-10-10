import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
  McpServer,
} from '@modelcontextprotocol/server';
import type { McpConfig } from './config.js';
import { AgentApiClient } from './http-client.js';
import { AgentApiError, redactSecret, toolError, type ToolTextResult } from './errors.js';
import { buildConfirmationPayload, confirmationDigest } from './confirmation.js';
import {
  confirmationAcceptedSchema,
  listAssignedTasksSchema,
  submitReviewResultSchema,
  taskIdSchema,
} from './schemas.js';
import type { SubmitReviewInput } from './types.js';

const confirmationRequestedSchema = {
  type: 'object' as const,
  properties: {
    confirm: {
      type: 'boolean' as const,
      title: 'Confirm writing this review result',
    },
    digest: {
      type: 'string' as const,
      title: 'Confirmation digest',
      description: 'The SHA-256 digest shown in this confirmation request.',
      pattern: '^[a-f0-9]{64}$',
    },
  },
  required: ['confirm', 'digest'],
  additionalProperties: false,
};

function jsonResult(value: unknown, secret: string): ToolTextResult {
  return { content: [{ type: 'text', text: redactSecret(JSON.stringify(value), secret) }] };
}

function markdownResult(markdown: string, secret: string): ToolTextResult {
  return { content: [{ type: 'text', text: redactSecret(markdown, secret) }] };
}

function safeDisplay(value: string, max = 500): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeSecretDisplay(value: string, secret: string, max = 500): string {
  return safeDisplay(redactSecret(value, secret), max);
}

function confirmationMessage(taskId: string, input: SubmitReviewInput, config: McpConfig, digest: string): string {
  const reasoningPreview = input.reasoning.length > 500 ? `${input.reasoning.slice(0, 500)}…` : input.reasoning;
  return [
    'Final confirmation required before writing an SLR review result.',
    `Profile: ${safeSecretDisplay(config.profileId, config.agentToken, 100)}`,
    `Project: ${safeSecretDisplay(config.projectName, config.agentToken, 160)} (${safeSecretDisplay(config.projectId, config.agentToken, 160)})`,
    `Task: ${safeSecretDisplay(taskId, config.agentToken, 160)}`,
    `Decision: ${safeSecretDisplay(input.decision, config.agentToken, 100)}`,
    `Reasoning preview (untrusted model text): ${safeSecretDisplay(reasoningPreview, config.agentToken)}`,
    `Payload digest: ${digest}`,
    'Choose confirm only if this exact payload is ready to be recorded in the SLR project.',
  ].join('\n');
}

export function registerAgentTools(server: McpServer, client: AgentApiClient, config: McpConfig): void {
  server.registerTool(
    'list_assigned_tasks',
    {
      title: 'List Assigned SLR Tasks',
      description: 'List review tasks assigned to this project-scoped SLR agent token. Process only ASSIGNED tasks. Pass nextCursor as cursor to continue pagination.',
      inputSchema: listAssignedTasksSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ limit, cursor }): Promise<ToolTextResult> => {
      try {
        return jsonResult(await client.listAssignedTasks(limit, cursor), config.agentToken);
      } catch (error) {
        return toolError(error, config.agentToken);
      }
    },
  );

  server.registerTool(
    'get_assigned_task',
    {
      title: 'Get Assigned SLR Task',
      description: 'Get one project-scoped assigned task with its project criteria, instructions, and paper metadata.',
      inputSchema: taskIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ taskId }): Promise<ToolTextResult> => {
      try {
        return jsonResult(await client.getAssignedTask(taskId), config.agentToken);
      } catch (error) {
        return toolError(error, config.agentToken);
      }
    },
  );

  server.registerTool(
    'get_task_fulltext',
    {
      title: 'Get SLR Task Full Text',
      description: 'Retrieve the assigned paper Markdown. If extraction is pending, return retryAfterSeconds and do not poll repeatedly inside this call.',
      inputSchema: taskIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ taskId }): Promise<ToolTextResult> => {
      try {
        const result = await client.getTaskFullText(taskId);
        return result.kind === 'ready' ? markdownResult(result.markdown, config.agentToken) : jsonResult(result, config.agentToken);
      } catch (error) {
        return toolError(error, config.agentToken);
      }
    },
  );

  server.registerTool(
    'submit_review_result',
    {
      title: 'Submit SLR Review Result',
      description: 'Write one review result and complete the assigned task. This changes project state. The review workflow must show the final decision, reasoning, and data to the user and obtain explicit confirmation before this tool is called; this tool also requests a final confirmation from the host before the POST is sent.',
      inputSchema: submitReviewResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ taskId, decision, reasoning, data }, context): Promise<ToolTextResult | InputRequiredResult> => {
      const input: SubmitReviewInput = { decision, reasoning, ...(data === undefined ? {} : { data }) };
      const digest = confirmationDigest(buildConfirmationPayload(config, taskId, input));
      const response = inputResponse(context.mcpReq.inputResponses, 'confirmation');
      if (response.kind === 'elicit' && response.action !== 'accept') {
        return jsonResult({ status: 'CANCELLED', message: 'Submission cancelled; no review result was written.' }, config.agentToken);
      }

      const confirmation = acceptedContent(context.mcpReq.inputResponses, 'confirmation', confirmationAcceptedSchema);
      if (!confirmation) {
        return inputRequired({
          inputRequests: {
            confirmation: inputRequired.elicit({
              message: confirmationMessage(taskId, input, config, digest),
              requestedSchema: confirmationRequestedSchema,
            }),
          },
        });
      }

      if (confirmation.digest !== digest) {
        return toolError(new AgentApiError('Confirmation does not match the current review payload', 409, 'CONFIRMATION_MISMATCH'), config.agentToken);
      }

      try {
        return jsonResult(await client.submitReviewResult(taskId, input), config.agentToken);
      } catch (error) {
        return toolError(error, config.agentToken);
      }
    },
  );
}
