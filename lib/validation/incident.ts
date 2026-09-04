import { z } from "zod";

export const createIncidentSchema = z.object({
  orgId: z.string().min(1),
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
});

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
