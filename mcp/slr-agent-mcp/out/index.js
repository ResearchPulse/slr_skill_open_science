#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
try {
    const config = loadConfig();
    const handle = serveStdio(() => createServer(config));
    console.error('SLR agent MCP server is running over stdio');
    process.on('SIGINT', () => {
        void handle.close();
    });
}
catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start SLR agent MCP server';
    console.error(`SLR agent MCP server startup failed: ${message}`);
    process.exitCode = 1;
}
//# sourceMappingURL=index.js.map