export type ToolTextResult = {
    content: [{
        type: 'text';
        text: string;
    }];
    isError?: boolean;
};
export declare class AgentApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly retryAfterSeconds?: number;
    constructor(message: string, status: number, code: string, retryAfterSeconds?: number);
}
export declare function redactSecret(message: string, secret?: string): string;
export declare function toolError(error: unknown, secret?: string): ToolTextResult;
//# sourceMappingURL=errors.d.ts.map