import * as z from 'zod/v4';

export const listAssignedTasksSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50).describe('Maximum tasks to return, from 1 to 100.'),
  cursor: z.string().trim().min(1).max(2000).optional().describe('Opaque cursor returned by the previous page.'),
}).strict();

export const taskIdSchema = z.object({
  taskId: z.string().trim().min(1).max(160).describe('Task identifier returned by list_assigned_tasks.'),
}).strict();

export const submitReviewResultSchema = z.object({
  taskId: z.string().trim().min(1).max(160).describe('Assigned task identifier.'),
  decision: z.string().trim().min(1).max(100).describe('Screening decision, commonly INCLUDE, EXCLUDE, or UNCERTAIN.'),
  reasoning: z.string().trim().min(1).max(16_000).describe('Evidence-based reasoning for the decision.'),
  data: z.record(z.string(), z.unknown()).optional().describe('Optional structured review fields.'),
}).strict();

export const confirmationAcceptedSchema = z.object({
  confirm: z.literal(true),
});

export type ListAssignedTasksInput = z.infer<typeof listAssignedTasksSchema>;
export type TaskIdInput = z.infer<typeof taskIdSchema>;
export type SubmitReviewResultInput = z.infer<typeof submitReviewResultSchema>;
