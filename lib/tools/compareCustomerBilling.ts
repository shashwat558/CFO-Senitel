import { z } from "zod";
import { compareCustomerBilling } from "../financial/billing";
import { monthSchema, orgIdSchema, yearSchema } from "../validation/common";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const compareCustomerBillingInput = z.object({
  orgId: orgIdSchema,
  customerId: z.string().min(1),
  year: yearSchema,
  month: monthSchema,
});

export type CompareCustomerBillingInput = z.infer<typeof compareCustomerBillingInput>;

async function run(input: CompareCustomerBillingInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  try {
    const output = await compareCustomerBilling(ctx.db, input.orgId, input.customerId, input.year, input.month);
    await auditToolCall(ctx, "compareCustomerBilling", input, true);
    return output;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    if (e instanceof Error && /customer not found/.test(e.message)) {
      throw new ToolError("NOT_FOUND", "customer not found");
    }
    throw e;
  }
}

export const compareCustomerBillingTool: ToolDefinition<
  CompareCustomerBillingInput,
  Awaited<ReturnType<typeof run>>
> = {
  name: "compareCustomerBilling",
  description:
    "One customer's billed total vs its trailing-3-month average, with a verdict (OK/MISSING_INVOICE/UNDER_BILLING/OVER_BILLING/TIMING). A heuristic flag for investigation — confirm against source documents, never a conclusion.",
  inputSchema: compareCustomerBillingInput,
  execute: run,
};
