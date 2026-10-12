import { McpServer } from '@modelcontextprotocol/server';
import {
  activeProfile,
  activateProfile,
  assertTokenConfigurationCredential,
  beginTokenConfiguration,
  captureProfileStore,
  cancelTokenConfiguration,
  commitTokenConfiguration,
  ensureOpenScienceCredential,
  finalizeTokenConfiguration,
  listProfiles,
  openScienceReport,
  registerConfigConnector,
  registerConnector,
  restoreProfileStore,
  tokenFingerprint,
} from './bridge.js';
import {
  cancelSchema,
  commitSchema,
  noArgumentsSchema,
  tokenConfigSchema,
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

function errorResult(code: string, message: string, details?: Record<string, unknown>): ToolTextResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message, ...(details || {}) } }) }],
  };
}

function safeError(error: unknown, secret = '', details?: Record<string, unknown>): ToolTextResult {
  let message = error instanceof Error ? error.message : 'SLR configuration operation failed.';
  if (secret) message = message.split(secret).join('[REDACTED]');
  return errorResult('CONFIGURATION_ERROR', message, details);
}

function registrationReport(): Record<string, unknown> {
  return openScienceReport(environment());
}

function completeConfiguration({
  operationId,
  action,
  profileName,
  token,
  env,
  validateBoundCredential,
}: {
  operationId: string;
  action: string;
  profileName?: string;
  token: string;
  env: NodeJS.ProcessEnv;
  validateBoundCredential: boolean;
}): ToolTextResult {
  let snapshot: Record<string, unknown> | null = null;
  let localCommitSucceeded = false;
  let credentialState = 'unchanged';
  let profileRestored: boolean | 'unknown' = false;
  const restoreSnapshot = () => {
    if (!snapshot) return;
    try {
      restoreProfileStore(snapshot, env);
      profileRestored = true;
    } catch {
      profileRestored = 'unknown';
    }
  };
  try {
    if (validateBoundCredential) {
      assertTokenConfigurationCredential(operationId, tokenFingerprint(token), env);
    }
    const report = registrationReport();
    const credentialBinding = ensureOpenScienceCredential(token, report);
    if (credentialBinding.configured !== true || !credentialBinding.credentialId) {
      try { cancelTokenConfiguration(operationId, env); } catch { /* Preserve the safe error. */ }
      return errorResult('CREDENTIAL_BINDING_FAILED', `Unable to bind SLR_AGENT_TOKEN (${credentialBinding.reason || 'unknown error'}).`, {
        profileRestored: false,
        credentialState: 'host-credential-may-have-changed',
        reconnectRequired: true,
      });
    }
    credentialState = 'updated';

    snapshot = captureProfileStore(env);
    const result = commitTokenConfiguration(
      operationId,
      action,
      env,
      profileName,
      String(credentialBinding.credentialId),
      tokenFingerprint(token),
    );
    const profile = result.profile as Parameters<typeof registerConnector>[0];
    const registration = registerConnector(profile, report);
    const configRegistration = registerConfigConnector(String(credentialBinding.credentialId), report);
    const connectorsReady = registration.registered === true && registration.enabled === true
      && configRegistration.registered === true && configRegistration.enabled === true;
    if (!connectorsReady) {
      restoreSnapshot();
      try { cancelTokenConfiguration(operationId, env); } catch { /* Preserve the safe error. */ }
      return errorResult(
        'CONNECTOR_REGISTRATION_FAILED',
        `Both connectors must be enabled before activation (review: ${registration.reason || 'failed'}, config: ${configRegistration.reason || 'failed'}).`,
        {
          profileRestored,
          credentialState,
          reconnectRequired: true,
        },
      );
    }

    const active = activateProfile(profile.name, env);
    finalizeTokenConfiguration(operationId, env);
    localCommitSucceeded = true;
    return jsonResult({
      ok: true,
      action: result.action,
      profile: active,
      connection: result.connection,
      match: result.match,
      credentialBinding: {
        configured: true,
        credentialId: credentialBinding.credentialId,
        displayName: credentialBinding.displayName,
      },
      connectorState: 'enabled',
      verification: 'reconnect_required',
    });
  } catch (error) {
    if (snapshot && !localCommitSucceeded) restoreSnapshot();
    try { cancelTokenConfiguration(operationId, env); } catch { /* Preserve the original error. */ }
    return safeError(error, token, snapshot || credentialState !== 'unchanged' ? {
      profileRestored,
      credentialState: credentialState === 'unchanged' ? 'unknown' : credentialState,
      reconnectRequired: true,
    } : undefined);
  }
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
    'slr_config_token',
    {
      title: 'Configure SLR Project Token',
      description: 'Validate and apply a project token for the explicit /slr config token command. The token is never returned, logged, or written to profile metadata or connector JSON.',
      inputSchema: tokenConfigSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ token, profileName, apiBaseUrl }): Promise<ToolTextResult> => {
      const candidateToken = String(token || '').trim();
      let operationId: string | undefined;
      try {
        const env = environment();
        const result = await beginTokenConfiguration({
          name: profileName,
          apiBaseUrl,
          token: candidateToken,
          environment: env,
        });
        operationId = typeof result.operationId === 'string' ? result.operationId : undefined;
        if (result.ok !== true) return jsonResult(result);
        const match = result.match as { requiresProfileChoice?: boolean } | undefined;
        if (match?.requiresProfileChoice === true && !profileName) {
          if (operationId) cancelTokenConfiguration(operationId, env);
          return jsonResult({
            ok: false,
            code: 'PROFILE_SELECTION_REQUIRED',
            message: 'The token matches multiple local profiles; choose one and retry the same command.',
            profile: result.profile,
            connection: result.connection,
            match,
            actions: result.actions,
          });
        }
        const action = Array.isArray(result.actions) ? result.actions[0] : undefined;
        if (!action || !operationId) return errorResult('CONFIGURATION_ERROR', 'The token configuration operation did not produce an action.');
        return completeConfiguration({
          operationId,
          action: String(action),
          profileName,
          token: candidateToken,
          env,
          validateBoundCredential: false,
        });
      } catch (error) {
        if (operationId) {
          try { cancelTokenConfiguration(operationId, environment()); } catch { /* Preserve the safe error. */ }
        }
        return safeError(error, candidateToken);
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
        const token = env['SLR_AGENT_TOKEN']?.trim();
        if (!token) return errorResult('CREDENTIAL_MISSING', 'Bind an Open-Science credential named SLR_AGENT_TOKEN to the SLR Config connector, then retry.');
        return completeConfiguration({
          operationId,
          action,
          profileName,
          token,
          env,
          validateBoundCredential: true,
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
