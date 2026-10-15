import { McpServer } from '@modelcontextprotocol/server';
import { AgentApiClient } from './http-client.js';
import type { McpConfig } from './config.js';
export declare const MCP_SERVER_NAME = "slr-agent-mcp-server";
export declare const MCP_SERVER_VERSION = "0.1.0";
export declare function createServer(config: McpConfig, client?: AgentApiClient): McpServer;
//# sourceMappingURL=server.d.ts.map