import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer as createHttpServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const originalConfigDir = globalThis.process['env']['SLR_CONFIG_DIR'];
const originalToken = globalThis.process['env']['SLR_AGENT_TOKEN'];

afterEach(() => {
  if (originalConfigDir === undefined) delete globalThis.process['env']['SLR_CONFIG_DIR'];
  else globalThis.process['env']['SLR_CONFIG_DIR'] = originalConfigDir;
  if (originalToken === undefined) delete globalThis.process['env']['SLR_AGENT_TOKEN'];
  else globalThis.process['env']['SLR_AGENT_TOKEN'] = originalToken;
});

async function connectedClient() {
  const server = createServer();
  const client = new Client({ name: 'slr-config-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe('SLR config MCP server', () => {
  it('exposes only the narrowly scoped configuration tools', async () => {
    globalThis.process['env']['SLR_CONFIG_DIR'] = 'C:/slr-config-test-does-not-exist';
    const { client, server } = await connectedClient();
    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name)).toEqual([
      'slr_config_profiles',
      'slr_config_validate',
      'slr_config_token',
      'slr_config_commit',
      'slr_config_cancel',
    ]);
    await client.close();
    await server.close();
  });

  it('lists safe metadata and never returns the bound token', async () => {
    globalThis.process['env']['SLR_CONFIG_DIR'] = 'C:/slr-config-test-does-not-exist';
    globalThis.process['env']['SLR_AGENT_TOKEN'] = 'slrp_config_test_secret';
    const { client, server } = await connectedClient();
    const result = await client.callTool({ name: 'slr_config_profiles', arguments: {} });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(result.isError).not.toBe(true);
    expect(text).not.toContain(globalThis.process['env']['SLR_AGENT_TOKEN']);
    expect(text).toContain('profiles');
    await client.close();
    await server.close();
  });

  it('fails closed when the host credential is not bound', async () => {
    globalThis.process['env']['SLR_CONFIG_DIR'] = 'C:/slr-config-test-does-not-exist';
    delete globalThis.process['env']['SLR_AGENT_TOKEN'];
    const { client, server } = await connectedClient();
    const result = await client.callTool({ name: 'slr_config_validate', arguments: {} });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(result.isError).toBe(true);
    expect(text).toContain('CREDENTIAL_MISSING');
    await client.close();
    await server.close();
  });

  it('validates an explicit token without returning the token when the API is unavailable', async () => {
    globalThis.process['env']['SLR_CONFIG_DIR'] = 'C:/slr-config-test-does-not-exist';
    delete globalThis.process['env']['SLR_AGENT_TOKEN'];
    const candidate = 'slrp_explicit_config_secret';
    const { client, server } = await connectedClient();
    const result = await client.callTool({
      name: 'slr_config_token',
      arguments: { token: candidate, apiBaseUrl: 'http://127.0.0.1:1/api' },
    });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).not.toContain(candidate);
    expect(text).toContain('connected');
    await client.close();
    await server.close();
  });

  it('reports credential uncertainty without returning the explicit token', async () => {
    const originalPath = globalThis.process['env']['PATH'];
    const originalPathCased = globalThis.process['env']['Path'];
    const originalOpenScienceCli = globalThis.process['env']['OPEN_SCIENCE_CLI'];
    const originalAppData = globalThis.process['env']['APPDATA'];
    const originalLocalAppData = globalThis.process['env']['LOCALAPPDATA'];
    const httpServer = createHttpServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        success: true,
        data: { project: { id: 'project-config-test', name: 'Config test' }, items: [], hasMore: false },
      }));
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const candidate = 'slrp_credential_failure_secret';
    try {
      globalThis.process['env']['SLR_CONFIG_DIR'] = 'C:/slr-config-test-does-not-exist';
      delete globalThis.process['env']['SLR_AGENT_TOKEN'];
      globalThis.process['env']['OPEN_SCIENCE_CLI'] = 'C:/slr-config-test-does-not-exist/open-science.cmd';
      globalThis.process['env']['APPDATA'] = 'C:/slr-config-test-does-not-exist';
      globalThis.process['env']['LOCALAPPDATA'] = 'C:/slr-config-test-does-not-exist';
      globalThis.process['env']['PATH'] = 'C:/slr-config-test-does-not-exist';
      globalThis.process['env']['Path'] = 'C:/slr-config-test-does-not-exist';
      const { client, server } = await connectedClient();
      const result = await client.callTool({
        name: 'slr_config_token',
        arguments: { token: candidate, apiBaseUrl: `http://127.0.0.1:${port}/api` },
      });
      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      expect(result.isError).toBe(true);
      expect(text).toContain('CREDENTIAL_BINDING_FAILED');
      expect(text).toContain('credentialState');
      expect(text).toContain('reconnectRequired');
      expect(text).not.toContain(candidate);
      await client.close();
      await server.close();
    } finally {
      httpServer.close();
      if (originalPath === undefined) delete globalThis.process['env']['PATH'];
      else globalThis.process['env']['PATH'] = originalPath;
      if (originalPathCased === undefined) delete globalThis.process['env']['Path'];
      else globalThis.process['env']['Path'] = originalPathCased;
      if (originalOpenScienceCli === undefined) delete globalThis.process['env']['OPEN_SCIENCE_CLI'];
      else globalThis.process['env']['OPEN_SCIENCE_CLI'] = originalOpenScienceCli;
      if (originalAppData === undefined) delete globalThis.process['env']['APPDATA'];
      else globalThis.process['env']['APPDATA'] = originalAppData;
      if (originalLocalAppData === undefined) delete globalThis.process['env']['LOCALAPPDATA'];
      else globalThis.process['env']['LOCALAPPDATA'] = originalLocalAppData;
    }
  });
});
