// Narrow typed boundary into the package's existing profile/config modules.
// @ts-ignore JavaScript CLI module without a separate declaration package.
import * as profileStoreModule from '../../../cli/profile-store.js';
// @ts-ignore JavaScript CLI module without a separate declaration package.
import * as setupModule from '../../../cli/setup.js';
// @ts-ignore JavaScript CLI module without a separate declaration package.
import * as cliModule from '../../../cli/slr.js';

export type ConfigEnvironment = NodeJS.ProcessEnv;

export interface PublicProfile {
  name: string;
  apiBaseUrl: string;
  projectId: string | null;
  projectName: string | null;
  credentialId: string | null;
  connectorId: string | null;
  connectorName: string | null;
  tokenSource: string;
  hasLocalToken: boolean;
  hasCredentialBinding: boolean;
  workspaceRoot: string;
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

type ProfileStoreApi = {
  listProfiles(environment: ConfigEnvironment): PublicProfile[];
  getActiveProfile(environment: ConfigEnvironment): PublicProfile | null;
};

type SetupApi = {
  beginTokenConfiguration(input: {
    name?: string;
    apiBaseUrl?: string;
    token: string;
    environment: ConfigEnvironment;
  }): Promise<Record<string, unknown>>;
  cancelTokenConfiguration(operationId: string, environment: ConfigEnvironment): Record<string, unknown>;
  commitTokenConfiguration(
    operationId: string,
    action: string,
    environment: ConfigEnvironment,
    selectedProfileName?: string,
  ): Record<string, unknown>;
};

type CliApi = {
  writeConnectorConfig(profile: PublicProfile, environment: ConfigEnvironment): string;
  writeConfigConnectorConfig(environment: ConfigEnvironment, credentialId?: string | null): string;
  registerConnector(profile: PublicProfile, report: Record<string, unknown>): Record<string, unknown>;
  registerConfigConnector(
    credentialId: string | null | undefined,
    report: Record<string, unknown>,
  ): Record<string, unknown>;
  openScienceReport(environment: ConfigEnvironment): Record<string, unknown>;
};

const profileStore = profileStoreModule as unknown as ProfileStoreApi;
const setup = setupModule as unknown as SetupApi;
const cli = cliModule as unknown as CliApi;

export function listProfiles(environment: ConfigEnvironment): PublicProfile[] {
  return profileStore.listProfiles(environment);
}

export function activeProfile(environment: ConfigEnvironment): PublicProfile | null {
  return profileStore.getActiveProfile(environment);
}

export function beginTokenConfiguration(input: {
  name?: string;
  apiBaseUrl?: string;
  token: string;
  environment: ConfigEnvironment;
}): Promise<Record<string, unknown>> {
  return setup.beginTokenConfiguration(input);
}

export function cancelTokenConfiguration(operationId: string, environment: ConfigEnvironment): Record<string, unknown> {
  return setup.cancelTokenConfiguration(operationId, environment);
}

export function commitTokenConfiguration(
  operationId: string,
  action: string,
  environment: ConfigEnvironment,
  selectedProfileName?: string,
): Record<string, unknown> {
  return setup.commitTokenConfiguration(operationId, action, environment, selectedProfileName);
}

export function writeConnectorConfig(profile: PublicProfile, environment: ConfigEnvironment): string {
  return cli.writeConnectorConfig(profile, environment);
}

export function writeConfigConnectorConfig(environment: ConfigEnvironment, credentialId?: string | null): string {
  return cli.writeConfigConnectorConfig(environment, credentialId);
}

export function registerConnector(profile: PublicProfile, report: Record<string, unknown>): Record<string, unknown> {
  return cli.registerConnector(profile, report);
}

export function registerConfigConnector(
  credentialId: string | null | undefined,
  report: Record<string, unknown>,
): Record<string, unknown> {
  return cli.registerConfigConnector(credentialId, report);
}

export function openScienceReport(environment: ConfigEnvironment): Record<string, unknown> {
  return cli.openScienceReport(environment);
}
