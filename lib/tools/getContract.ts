import { z } from "zod";
import { auditToolCall, ensureOrgMatch, ToolError, type ToolContext, type ToolDefinition } from "./types";

export const getContractInput = z
  .object({
    orgId: z.string().min(1),
    contractId: z.string().min(1).optional(),
    contractNumber: z.string().min(1).optional(),
    vendorId: z.string().min(1).optional(),
  })
  .refine((v) => v.contractId ?? v.contractNumber ?? v.vendorId, {
    message: "provide at least one of contractId, contractNumber, vendorId",
  });

export type GetContractInput = z.infer<typeof getContractInput>;

async function run(input: GetContractInput, ctx: ToolContext) {
  ensureOrgMatch(ctx, input.orgId);
  if (input.contractId ?? input.contractNumber) {
    const contract = await ctx.db.contract.findFirst({
      where: {
        orgId: input.orgId,
        ...(input.contractId ? { id: input.contractId } : { contractNumber: input.contractNumber! }),
      },
      include: { vendor: true },
    });
    if (!contract) throw new ToolError("NOT_FOUND", "contract not found");
    await auditToolCall(ctx, "getContract", input, true);
    return serialize(contract);
  }
  const contracts = await ctx.db.contract.findMany({
    where: { orgId: input.orgId, vendorId: input.vendorId! },
    include: { vendor: true },
    orderBy: { startDate: "desc" },
  });
  if (contracts.length === 0) throw new ToolError("NOT_FOUND", "no contracts for vendor");
  await auditToolCall(ctx, "getContract", input, true);
  return contracts.map(serialize);
}

function serialize(c: {
  id: string; contractNumber: string; title: string; material: string;
  unitOfMeasure: string; unitPrice: unknown; quantity: unknown; totalValue: unknown;
  status: string; startDate: Date; endDate: Date;
  vendor: { id: string; name: string; code: string };
}) {
  return {
    id: c.id,
    contractNumber: c.contractNumber,
    title: c.title,
    material: c.material,
    unitOfMeasure: c.unitOfMeasure,
    unitPrice: Number(c.unitPrice),
    quantity: Number(c.quantity),
    totalValue: Number(c.totalValue),
    status: c.status,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate.toISOString(),
    vendor: c.vendor,
  };
}

export const getContractTool: ToolDefinition<GetContractInput, Awaited<ReturnType<typeof run>>> = {
  name: "getContract",
  description:
    "Fetch contract(s): by contractId/contractNumber for one contract, or by vendorId for that vendor's contracts. Returns agreed unit prices.",
  inputSchema: getContractInput,
  execute: run,
};
