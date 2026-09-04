// Approval types (Phase 3). Consequential actions require human approval.
// Phase 1: approvals are listed in the UI; no approval flow executes yet.

import { z } from "zod";

export const approvalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decidedById: z.string().min(1),
  reason: z.string().max(2000).default(""),
});

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
