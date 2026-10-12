import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
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
  it('exposes only the four narrowly scoped configuration tools', async () => {
    globalThis.process['env']['SLR_CONFIG_DIR'] = 'C:/slr-config-test-does-not-exist';
    const { client, server } = await connectedClient();
    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name)).toEqual([
      'slr_config_profiles',
      'slr_config_validate',
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
});
