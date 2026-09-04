// Action types (Phase 3+: recommendation → approval → simulated execution).
// Phase 1 creates no actions; the IncidentAction model + statuses exist.

import { z } from "zod";

export const proposedActionSchema = z.object({
  incidentId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(3).max(200),
  description: z.string().max(5000).default(""),
  payload: z.record(z.unknown()).default({}),
});

export type ProposedAction = z.infer<typeof proposedActionSchema>;
