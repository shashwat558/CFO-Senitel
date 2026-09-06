import { z } from "zod";

// The tenant is NOT part of the transport contract: orgId always comes from
// the session (lib/auth/session.ts) and any client-supplied orgId is stripped
// by Zod before a write — the API can never be spoofed into another org.
export const createIncidentSchema = z
  .object({
    title: z.string().min(3).max(200),
    description: z.string().max(5000).default(""),
    type: z
      .enum([
        "GROSS_MARGIN_DECLINE",
        "CASH_CRISIS",
        "REVENUE_LEAKAGE",
        "EXPENSE_SPIKE",
        "OTHER",
      ])
      .default("OTHER"),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
    periodStart: z.string().datetime({ offset: true }).optional(),
    periodEnd: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (v) => (v.periodStart !== undefined) === (v.periodEnd !== undefined),
    { message: "provide both periodStart and periodEnd or neither" }
  )
  .refine(
    (v) => {
      if (v.periodStart && v.periodEnd) {
        return new Date(v.periodStart).getTime() < new Date(v.periodEnd).getTime();
      }
      return true;
    },
    { message: "periodStart must be before periodEnd" }
  );

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
