import { z } from "zod";
import { getApAging } from "../financial/aging";
import { orgIdSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const getApAgingInput = z.object({
  orgId: orgIdSchema,
  asOf: z.string().datetime({ offset: true }).optional(),
});

export type GetApAgingInput = z.infer<typeof getApAgingInput>;

const DEFAULT_ASOF = "2025-01-01T00:00:00.000Z";

async function run(input: GetApAgingInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const asOf = new Date(input.asOf ?? DEFAULT_ASOF);
  if (Number.isNaN(asOf.getTime())) throw new ToolError("INVALID_RANGE", "invalid asOf date");
  const output = await getApAging(ctx.db, input.orgId, asOf);
  await auditToolCall(ctx, "getApAging", input, true, { rowCount: output.rows.length });
  return output;
}

export const getApAgingTool: ToolDefinition<GetApAgingInput, Awaited<ReturnType<typeof run>>> = {
  name: "getApAging",
  description:
    "AP aging over unpaid bills (current/1-30/31-60/61-90/90+ days past due). Use to find concentrated vendor obligations hitting cash.",
  inputSchema: getApAgingInput,
  execute: run,
};
