import { McpServer } from '@modelcontextprotocol/server';
import {
  activeProfile,
  beginTokenConfiguration,
  cancelTokenConfiguration,
  commitTokenConfiguration,
  listProfiles,
  openScienceReport,
  registerConfigConnector,
  registerConnector,
  writeConfigConnectorConfig,
  writeConnectorConfig,
} from './bridge.js';
import {
  cancelSchema,
  commitSchema,
  noArgumentsSchema,
  validateSchema,
} from './schemas.js';

export const MCP_SERVER_NAME = 'slr-config-mcp';
export const MCP_SERVER_VERSION = '0.1.0';

type ToolTextResult = {
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
};

function environment(): NodeJS.ProcessEnv {
  return globalThis.process['env'];
}

function jsonResult(value: unknown): ToolTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(code: string, message: string): ToolTextResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }],
  };
}

function safeError(error: unknown): ToolTextResult {
  const message = error instanceof Error ? error.message : 'SLR configuration operation failed.';
  return errorResult('CONFIGURATION_ERROR', message);
}

function registrationReport(): Record<string, unknown> {
  return openScienceReport(environment());
}

export function createServer(): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });

  server.registerTool(
    'slr_config_profiles',
    {
      title: 'List SLR Profiles',
      description: 'List safe local SLR profile metadata. Tokens and secret files are never returned.',
      inputSchema: noArgumentsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (): Promise<ToolTextResult> => {
      try {
        const env = environment();
        return jsonResult({ activeProfile: activeProfile(env), profiles: listProfiles(env) });
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    'slr_config_validate',
    {
      title: 'Validate SLR Project Credential',
      description: 'Validate the host-bound SLR_AGENT_TOKEN and stage one protected local configuration operation. The token is never an MCP argument or result.',
      inputSchema: validateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ profileName, apiBaseUrl }): Promise<ToolTextResult> => {
      const token = environment()['SLR_AGENT_TOKEN']?.trim();
      if (!token) return errorResult('CREDENTIAL_MISSING', 'Bind an Open-Science credential named SLR_AGENT_TOKEN to the SLR Config connector, then retry.');
      try {
        const result = await beginTokenConfiguration({
          name: profileName,
          apiBaseUrl,
          token,
          environment: environment(),
        });
        return jsonResult(result);
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    'slr_config_commit',
    {
      title: 'Commit SLR Profile Configuration',
      description: 'Commit the exact validated SLR profile action, refresh the secret-free connector configs, and attempt to reconnect both local connectors.',
      inputSchema: commitSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ operationId, action, profileName }): Promise<ToolTextResult> => {
      try {
        const env = environment();
        const result = commitTokenConfiguration(operationId, action, env, profileName);
        const profile = result.profile as Parameters<typeof writeConnectorConfig>[0];
        const connectorConfigPath = writeConnectorConfig(profile, env);
        const registration = registerConnector(profile, registrationReport());
        const configConnectorConfigPath = writeConfigConnectorConfig(env, profile.credentialId);
        const configRegistration = registerConfigConnector(profile.credentialId, registrationReport());
        return jsonResult({
          ...result,
          connectorConfigPath,
          registration,
          configConnectorConfigPath,
          configRegistration,
          connectorState: registration.registered && registration.enabled ? 'enabled' : 'reconnect_required',
        });
      } catch (error) {
        return safeError(error);
      }
    },
  );

  server.registerTool(
    'slr_config_cancel',
    {
      title: 'Cancel SLR Profile Configuration',
      description: 'Cancel a pending SLR profile configuration operation without changing the active profile.',
      inputSchema: cancelSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ operationId }): Promise<ToolTextResult> => {
      try {
        return jsonResult(cancelTokenConfiguration(operationId, environment()));
      } catch (error) {
        return safeError(error);
      }
    },
  );

  return server;
}
