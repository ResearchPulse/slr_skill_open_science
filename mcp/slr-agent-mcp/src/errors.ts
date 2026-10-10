export type ToolTextResult = {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
};

export class AgentApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, code: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AgentApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function redactSecret(message: string, secret?: string): string {
  if (!secret) return message;
  return message.split(secret).join('[redacted]');
}

export function toolError(error: unknown, secret?: string): ToolTextResult {
  if (error instanceof AgentApiError) {
    const safeCode = secret && error.code.includes(secret) ? 'REDACTED_ERROR_CODE' : error.code;
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: {
            code: safeCode,
            status: error.status,
            message: redactSecret(error.message, secret),
            ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
          },
        }),
      }],
    };
  }

  const message = error instanceof Error ? error.message : 'Unexpected MCP server error';
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({ error: { code: 'INTERNAL_ERROR', status: 500, message: redactSecret(message, secret) } }),
    }],
  };
}
