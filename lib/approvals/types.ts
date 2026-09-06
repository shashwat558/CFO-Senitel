// Approval types (Phase 3). Consequential actions require human approval.
// Wired into POST /api/approvals/[id]/approve|reject — the decision schema
// is the canonical contract; the approval service validates against it.

import { z } from "zod";

export const approvalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  // Role-check stub: no auth session exists yet. When a decider is supplied
  // the service resolves the user and enforces an approver role (403
  // otherwise); when omitted the decision is recorded with actor null.
  decidedById: z.string().min(1).optional(),
  reason: z.string().max(2000).default(""),
});

/** Body schema for POST /api/approvals/[id]/approve|reject — the approval id
 *  comes from the URL, not the body. */
export const approveRejectSchema = approvalDecisionSchema.omit({ approvalId: true });

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type ApproveRejectInput = z.infer<typeof approveRejectSchema>;