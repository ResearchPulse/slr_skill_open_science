import { describe, expect, it } from 'vitest';
import { buildConfirmationPayload, confirmationDigest } from '../src/confirmation.js';

const config = { profileId: 'profile-a', projectId: 'project-a' } as any;

describe('confirmation digest', () => {
  it('canonicalizes object key order but binds every payload field', () => {
    const first = buildConfirmationPayload(config, 'task-1', {
      decision: 'INCLUDE',
      reasoning: 'Evidence matches.',
      data: { confidence: 0.9, evidence: ['a', 'b'] },
    });
    const reordered = buildConfirmationPayload(config, 'task-1', {
      decision: 'INCLUDE',
      reasoning: 'Evidence matches.',
      data: { evidence: ['a', 'b'], confidence: 0.9 },
    });

    expect(confirmationDigest(first)).toBe(confirmationDigest(reordered));
    for (const [key, value] of Object.entries({
      profileId: 'profile-b',
      projectId: 'project-b',
      taskId: 'task-2',
      decision: 'EXCLUDE',
      reasoning: 'Different evidence.',
    })) {
      expect(confirmationDigest({ ...first, [key]: value } as any)).not.toBe(confirmationDigest(first));
    }
    expect(confirmationDigest({ ...first, data: { confidence: 0.8 } })).not.toBe(confirmationDigest(first));
  });
});
