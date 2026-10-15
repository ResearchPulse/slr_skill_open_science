export class AgentApiError extends Error {
    status;
    code;
    retryAfterSeconds;
    constructor(message, status, code, retryAfterSeconds) {
        super(message);
        this.name = 'AgentApiError';
        this.status = status;
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
export function redactSecret(message, secret) {
    if (!secret)
        return message;
    return message.split(secret).join('[redacted]');
}
export function toolError(error, secret) {
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
    const message = 'Unexpected MCP server error; inspect the structured error code and retry only a read-only operation if appropriate.';
    return {
        isError: true,
        content: [{
                type: 'text',
                text: JSON.stringify({ error: { code: 'INTERNAL_ERROR', status: 500, message: redactSecret(message, secret) } }),
            }],
    };
}
//# sourceMappingURL=errors.js.map