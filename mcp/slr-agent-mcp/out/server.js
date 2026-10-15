import { McpServer } from '@modelcontextprotocol/server';
import { AgentApiClient } from './http-client.js';
import { registerAgentTools } from './tools.js';
export const MCP_SERVER_NAME = 'slr-agent-mcp-server';
export const MCP_SERVER_VERSION = '0.1.0';
export function createServer(config, client = new AgentApiClient(config)) {
    const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
    registerAgentTools(server, client, config);
    return server;
}
//# sourceMappingURL=server.js.map