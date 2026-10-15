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
export declare function listProfiles(environment: ConfigEnvironment): PublicProfile[];
export declare function activeProfile(environment: ConfigEnvironment): PublicProfile | null;
export declare function configureProfileUrl(name: string | undefined, apiBaseUrl: string, environment: ConfigEnvironment): PublicProfile;
export declare function captureProfileStore(environment: ConfigEnvironment): Record<string, unknown>;
export declare function restoreProfileStore(snapshot: Record<string, unknown>, environment: ConfigEnvironment): PublicProfile | null;
export declare function activateProfile(name: string, environment: ConfigEnvironment): PublicProfile;
export declare function tokenFingerprint(value: string): string;
export declare function beginTokenConfiguration(input: {
    name?: string;
    apiBaseUrl?: string;
    token: string;
    environment: ConfigEnvironment;
}): Promise<Record<string, unknown>>;
export declare function cancelTokenConfiguration(operationId: string, environment: ConfigEnvironment): Record<string, unknown>;
export declare function assertTokenConfigurationCredential(operationId: string, currentTokenFingerprint: string, environment: ConfigEnvironment): Record<string, unknown>;
export declare function tokenConfigurationTargetProfileName(operationId: string, selectedProfileName: string | undefined, environment: ConfigEnvironment): string;
export declare function commitTokenConfiguration(operationId: string, action: string, environment: ConfigEnvironment, selectedProfileName?: string, credentialId?: string, currentTokenFingerprint?: string): Record<string, unknown>;
export declare function finalizeTokenConfiguration(operationId: string, environment: ConfigEnvironment): Record<string, unknown>;
export declare function projectTokenCredentialName(profileName?: string): string;
export declare function ensureOpenScienceCredential(token: string, report: Record<string, unknown>, displayName?: string): Record<string, unknown>;
export declare function registerConnector(profile: PublicProfile, report: Record<string, unknown>): Record<string, unknown>;
export declare function registerConfigConnector(credentialId: string | null | undefined, report: Record<string, unknown>): Record<string, unknown>;
export declare function openScienceReport(environment: ConfigEnvironment): Record<string, unknown>;
//# sourceMappingURL=bridge.d.ts.map