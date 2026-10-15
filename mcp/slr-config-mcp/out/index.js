#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
try {
    const handle = serveStdio(() => createServer());
    console.error('SLR config MCP server is running over stdio');
    process.on('SIGINT', () => { void handle.close(); });
}
catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to start SLR config MCP server');
    process.exitCode = 1;
}
//# sourceMappingURL=index.js.map