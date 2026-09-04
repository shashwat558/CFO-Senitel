import { z } from "zod";
import { auditToolCall, ensureOrgMatch, type ToolContext, type ToolDefinition } from "./types";

export const getInvoicesInput = z.object({
  orgId: z.string().min(1),
  vendorId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  type: z.enum(["AP", "AR"]).optional(),
  status: z.enum(["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"]).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type GetInvoicesInput = z.infer<typeof getInvoicesInput>;

async function run(input: GetInvoicesInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  if ((input.startDate && !input.endDate) || (!input.startDate && input.endDate)) {
    throw new Error("provide both startDate and endDate or neither");
  }
  const invoices = await ctx.db.invoice.findMany({
    where: {
      orgId: input.orgId,
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.startDate && input.endDate
        ? { issueDate: { gte: new Date(input.startDate), lt: new Date(input.endDate) } }
        : {}),
    },
    include: { vendor: true, customer: true },
    orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
    take: input.limit,
  });
  const output = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    type: inv.type,
    status: inv.status,
    vendor: inv.vendor ? { id: inv.vendor.id, name: inv.vendor.name, code: inv.vendor.code } : null,
    customer: inv.customer ? { id: inv.customer.id, name: inv.customer.name } : null,
    material: inv.material,
    quantity: inv.quantity === null ? null : Number(inv.quantity),
    unitPrice: inv.unitPrice === null ? null : Number(inv.unitPrice),
    subtotal: Number(inv.subtotal),
    total: Number(inv.total),
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate?.toISOString() ?? null,
  }));
  await auditToolCall(ctx, "getInvoices", input, true, { resultCount: output.length });
  return output;
}

export const getInvoicesTool: ToolDefinition<GetInvoicesInput, Awaited<ReturnType<typeof run>>> = {
  name: "getInvoices",
  description:
    "List invoices with filters (vendor, customer, AP/AR, status, date range). Evidence for price and spend claims. Max 100 rows.",
  inputSchema: getInvoicesInput,
  execute: run,
};
