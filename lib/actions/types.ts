// Action types (Phase 3: recommendation → approval → simulated execution).
// Wired into POST /api/incidents/[id]/actions (propose) — the schema is the
// canonical transport contract; the action service validates against it.

import { z } from "zod";

export const proposedActionSchema = z.object({
  incidentId: z.string().min(1),
  // The originating finding; the propose endpoint validates it belongs to the
  // incident and records it in the action payload.
  findingId: z.string().min(1),
  type: z.string().min(1).default("RECOMMENDATION"),
  title: z.string().min(3).max(200),
  description: z.string().max(5000).default(""),
  payload: z.record(z.unknown()).default({}),
});

export type ProposedAction = z.infer<typeof proposedActionSchema>;