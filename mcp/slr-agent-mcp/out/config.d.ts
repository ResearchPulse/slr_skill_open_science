export interface McpConfig {
    apiBaseUrl: string;
    agentToken: string;
    timeoutMs: number;
    profileId: string;
    projectId: string;
    projectName: string;
    allowedHosts: string[];
    maxJsonResponseBytes: number;
    maxMarkdownResponseBytes: number;
}
export declare function loadConfig(environment?: NodeJS.ProcessEnv): McpConfig;
//# sourceMappingURL=config.d.ts.map