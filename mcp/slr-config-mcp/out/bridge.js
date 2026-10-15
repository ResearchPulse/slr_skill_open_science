// Narrow typed boundary into the package's existing profile/config modules.
// @ts-ignore JavaScript CLI module without a separate declaration package.
import * as profileStoreModule from '../../../cli/profile-store.js';
// @ts-ignore JavaScript CLI module without a separate declaration package.
import * as setupModule from '../../../cli/setup.js';
// @ts-ignore JavaScript CLI module without a separate declaration package.
import * as cliModule from '../../../cli/slr.js';
const profileStore = profileStoreModule;
const setup = setupModule;
const cli = cliModule;
export function listProfiles(environment) {
    return profileStore.listProfiles(environment);
}
export function activeProfile(environment) {
    return profileStore.getActiveProfile(environment);
}
export function configureProfileUrl(name, apiBaseUrl, environment) {
    const profileName = name || profileStore.getActiveProfile(environment)?.name || 'default';
    try {
        return profileStore.updateProfile(profileName, { apiBaseUrl }, environment);
    }
    catch (error) {
        if (name || !/profile not found/i.test(error instanceof Error ? error.message : ''))
            throw error;
        return profileStore.createProfile({ name: profileName, apiBaseUrl }, environment);
    }
}
export function captureProfileStore(environment) {
    return profileStore.captureProfileStore(environment);
}
export function restoreProfileStore(snapshot, environment) {
    return profileStore.restoreProfileStore(snapshot, environment);
}
export function activateProfile(name, environment) {
    return profileStore.useProfile(name, environment);
}
export function tokenFingerprint(value) {
    return profileStore.tokenFingerprint(value);
}
export function beginTokenConfiguration(input) {
    return setup.beginTokenConfiguration(input);
}
export function cancelTokenConfiguration(operationId, environment) {
    return setup.cancelTokenConfiguration(operationId, environment);
}
export function assertTokenConfigurationCredential(operationId, currentTokenFingerprint, environment) {
    return setup.assertTokenConfigurationCredential(operationId, currentTokenFingerprint, environment);
}
export function tokenConfigurationTargetProfileName(operationId, selectedProfileName, environment) {
    return setup.tokenConfigurationTargetProfileName(operationId, selectedProfileName, environment);
}
export function commitTokenConfiguration(operationId, action, environment, selectedProfileName, credentialId, currentTokenFingerprint) {
    return setup.commitTokenConfiguration(operationId, action, environment, selectedProfileName, credentialId, currentTokenFingerprint);
}
export function finalizeTokenConfiguration(operationId, environment) {
    return setup.finalizeTokenConfiguration(operationId, environment);
}
export function projectTokenCredentialName(profileName) {
    return cli.projectTokenCredentialName(profileName);
}
export function ensureOpenScienceCredential(token, report, displayName) {
    return cli.ensureOpenScienceCredential(token, report, undefined, undefined, displayName);
}
export function registerConnector(profile, report) {
    return cli.registerConnector(profile, report);
}
export function registerConfigConnector(credentialId, report) {
    return cli.registerConfigConnector(credentialId, report);
}
export function openScienceReport(environment) {
    return cli.openScienceReport(environment);
}
//# sourceMappingURL=bridge.js.map