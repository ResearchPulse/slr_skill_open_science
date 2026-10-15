import { createHash } from 'node:crypto';
function canonicalize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(item => canonicalize(item)).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}
export function buildConfirmationPayload(config, taskId, input) {
    return {
        profileId: config.profileId,
        projectId: config.projectId,
        taskId,
        decision: input.decision,
        reasoning: input.reasoning,
        ...(input.data === undefined ? {} : { data: input.data }),
    };
}
export function confirmationDigest(payload) {
    return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}
//# sourceMappingURL=confirmation.js.map