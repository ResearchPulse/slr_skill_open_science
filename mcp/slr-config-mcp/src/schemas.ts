import * as z from 'zod/v4';

export const noArgumentsSchema = z.object({}).strict();

export const validateSchema = z.object({
  profileName: z.string().trim().min(1).max(64).optional().describe('Local profile to create or validate.'),
  apiBaseUrl: z.string().trim().url().max(500).optional().describe('Optional SLR API base URL; use the configured production URL when omitted.'),
}).strict();

export const commitSchema = z.object({
  operationId: z.string().trim().regex(/^[a-f0-9-]{16,80}$/i).describe('Opaque operation ID returned by slr_config_validate.'),
  action: z.enum(['save', 'switch', 'update']).describe('The exact action returned by slr_config_validate.'),
  profileName: z.string().trim().min(1).max(64).optional().describe('Required only when validation matched multiple profiles.'),
}).strict();

export const cancelSchema = z.object({
  operationId: z.string().trim().regex(/^[a-f0-9-]{16,80}$/i).describe('Opaque operation ID returned by slr_config_validate.'),
}).strict();
