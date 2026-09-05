// Tool registry — the ONLY surface the future Investigator Agent may use.
// The agent must never access Prisma directly; it calls executeTool(),
// which validates input with Zod, runs the deterministic service path,
// and audit-logs the call.

import type { ToolContext, ToolDefinition } from "./types";
import { auditToolCall, ToolError } from "./types";
import { getPnlTool } from "./getPnl";
import { getVendorSpendTool } from "./getVendorSpend";
import { comparePeriodsTool } from "./comparePeriods";
import { breakDownMetricTool } from "./breakDownMetric";
import { getContractTool } from "./getContract";
import { getInvoicesTool } from "./getInvoices";
import { compareVendorPricesTool } from "./compareVendorPrices";
import { calculateFinancialImpactTool } from "./calculateFinancialImpact";

export const TOOL_REGISTRY: Record<string, ToolDefinition<never, unknown>> = {
  [getPnlTool.name]: getPnlTool as unknown as ToolDefinition<never, unknown>,
  [getVendorSpendTool.name]: getVendorSpendTool as unknown as ToolDefinition<never, unknown>,
  [comparePeriodsTool.name]: comparePeriodsTool as unknown as ToolDefinition<never, unknown>,
  [breakDownMetricTool.name]: breakDownMetricTool as unknown as ToolDefinition<never, unknown>,
  [getContractTool.name]: getContractTool as unknown as ToolDefinition<never, unknown>,
  [getInvoicesTool.name]: getInvoicesTool as unknown as ToolDefinition<never, unknown>,
  [compareVendorPricesTool.name]: compareVendorPricesTool as unknown as ToolDefinition<never, unknown>,
  [calculateFinancialImpactTool.name]: calculateFinancialImpactTool as unknown as ToolDefinition<never, unknown>,
};

export const TOOL_NAMES = Object.keys(TOOL_REGISTRY);

export function listTools(): Array<{ name: string; description: string }> {
  return TOOL_NAMES.map((name) => ({
    name,
    description: (TOOL_REGISTRY[name] as { description: string }).description,
  }));
}

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<unknown> {
  const tool = TOOL_REGISTRY[name];
  if (!tool) throw new ToolError("UNKNOWN_TOOL", `unknown tool: ${name}`);
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolError("VALIDATION", `invalid input for ${name}: ${parsed.error.message}`);
  }
  try {
    return await tool.execute(parsed.data as never, ctx);
  } catch (err) {
    // Best-effort failure audit so failed validations and ToolErrors are
    // visible in AuditLog (success paths audit inside each tool).
    if (ctx.audit !== false) {
      try {
        await auditToolCall(ctx, name, rawInput, false, {
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: unknown }).code ?? "ERROR",
        });
      } catch {
        // Audit must never break tool execution.
      }
    }
    throw err;
  }
}
