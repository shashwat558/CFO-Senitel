import { z } from "zod";
import { getArAging } from "../financial/aging";
import { orgIdSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const getArAgingInput = z.object({
  orgId: orgIdSchema,
  asOf: z.string().datetime({ offset: true }).optional(),
});

export type GetArAgingInput = z.infer<typeof getArAgingInput>;

const DEFAULT_ASOF = "2025-01-01T00:00:00.000Z";

async function run(input: GetArAgingInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  const asOf = new Date(input.asOf ?? DEFAULT_ASOF);
  if (Number.isNaN(asOf.getTime())) throw new ToolError("INVALID_RANGE", "invalid asOf date");
  const output = await getArAging(ctx.db, input.orgId, asOf);
  await auditToolCall(ctx, "getArAging", input, true, { rowCount: output.rows.length });
  return output;
}

export const getArAgingTool: ToolDefinition<GetArAgingInput, Awaited<ReturnType<typeof run>>> = {
  name: "getArAging",
  description:
    "AR aging over unpaid invoices (current/1-30/31-60/61-90/90+ days past due). Use to find delayed customers dragging collections.",
  inputSchema: getArAgingInput,
  execute: run,
};
