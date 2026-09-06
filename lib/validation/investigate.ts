// Transport validation for POST /api/incidents/[id]/investigate.
// The route parses the body here; the loop enforces its own limits
// (maxIterations default 8, maxLlmRetries default 2, per-request LLM
// timeout) at the agent layer.

import { z } from "zod";

export const investigateIncidentSchema = z.object({
  question: z.string().min(3).max(2000, "question must be 3-2000 characters"),
  maxIterations: z.number().int().min(1).max(50).optional(),
  // Cost cap: bound LLM retries per call; the loop already slices every
  // tool result to 8k chars before feeding it back.
  maxLlmRetries: z.number().int().min(0).max(5).optional(),
  // NOTE: no actorId field — the audit actor is the session user, never a
  // client-supplied id (same spoofing rule as orgId on incident create).
});

export type InvestigateIncidentInput = z.infer<typeof investigateIncidentSchema>;