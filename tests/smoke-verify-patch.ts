/* Smoke test (run with tsx against a live seeded DB) — not part of the suite.
 * Exercises the real services end-to-end:
 *   PATCH statusing + assignment → propose/approve/execute → verifyAction
 *   (re-queries getPnl + compareVendorPrices, auto RESOLVED → CLOSED).
 */
import { prisma } from "../lib/db/prisma";
import { getDefaultOrg } from "../lib/services/org";
import { updateIncident } from "../lib/services/incidents";
import { proposeAction } from "../lib/services/actions";
import { decideApproval } from "../lib/services/approvals";
import { executeAction } from "../lib/services/actions";
import { verifyAction } from "../lib/verification/runner";
import { compareVendorPricesTool } from "../lib/tools/compareVendorPrices";
import { getPnlTool } from "../lib/tools/getPnl";

async function main() {
  const org = await getDefaultOrg(prisma);
  const incident = await prisma.financialIncident.findFirstOrThrow();
  const incidentId = incident.id;
  const controller = await prisma.user.findFirstOrThrow({ where: { orgId: org.id, role: "CONTROLLER" } });
  const cfo = await prisma.user.findFirstOrThrow({ where: { orgId: org.id, role: "CFO" } });

  // 1. PATCH: OPEN → INVESTIGATING + assignment (real transition + assignee)
  const investigating = await updateIncident(prisma, org.id, incidentId, {
    status: "INVESTIGATING",
    assignedToId: controller.id,
  });
  console.log("PATCH OPEN->INVESTIGATING+assign:", investigating.status, "| assignedTo:", investigating.assignedToId);

  // 2. PATCH: move to PENDING_APPROVAL so verify can auto-resolve
  const pending = await updateIncident(prisma, org.id, incidentId, { status: "PENDING_APPROVAL" });
  console.log("PATCH INVESTIGATING->PENDING_APPROVAL:", pending.status);

  // 3. Invalid transition must be a 400-class ValidationError
  try {
    await updateIncident(prisma, org.id, incidentId, { status: "OPEN" });
    console.log("UNEXPECTED: PENDING_APPROVAL->OPEN allowed");
  } catch (e) {
    console.log("PATCH PENDING_APPROVAL->OPEN: rejected ->", (e as Error).message);
  }

  // Fresh evidence for expected figures (real tool calls, Aug 2024 Apex)
  const cvp = await compareVendorPricesTool.execute(
    { orgId: org.id, vendorId: "vendor_apex", startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z" },
    { db: prisma, orgId: org.id, audit: false }
  );
  const pnl = await getPnlTool.execute(
    { orgId: org.id, year: 2024, month: 8 },
    { db: prisma, orgId: org.id, audit: false }
  );
  console.log("fresh compareVendorPrices:", { estimatedImpact: cvp.estimatedImpact, avgUnitPrice: cvp.avgUnitPrice, invoiceCount: cvp.invoiceCount });
  console.log("fresh getPnl:", { grossProfit: pnl.grossProfit, grossMargin: pnl.grossMargin, revenue: pnl.revenue });

  const finding = await prisma.incidentFinding.create({
    data: { incidentId, title: "Apex overcharge drives margin decline", rank: 1, confidence: 0.9 },
  });

  const runChain = async (toolName: string, input: Record<string, unknown>, expected: Record<string, unknown>, title: string, wrong = false) => {
    const { action, approval } = await proposeAction(prisma, org.id, {
      incidentId,
      findingId: finding.id,
      title,
      payload: { verification: { toolName, input, expected } },
    });
    const { action: approved } = await decideApproval(prisma, org.id, {
      approvalId: approval.id,
      decision: "APPROVED",
      decidedById: cfo.id,
      reason: "smoke",
    });
    if (!approved) throw new Error("smoke: approval did not update the action");
    const executed = await executeAction(prisma, org.id, approved.id);
    const out = await verifyAction(prisma, org.id, executed.id);
    const now = await prisma.financialIncident.findUnique({ where: { id: incidentId } });
    console.log(`verify ${toolName} [${wrong ? "expected WRONG figures" : "expected true figures"}]:`, {
      verified: out.result.verified,
      actionStatus: out.action.status,
      incidentStatus: now?.status,
      detail: out.result.detail.slice(0, 120),
    });
    return now?.status;
  };

  // 4. verify pass (compareVendorPrices, true figures) -> action VERIFIED, incident PENDING_APPROVAL -> RESOLVED
  await runChain("compareVendorPrices", { orgId: org.id, vendorId: "vendor_apex", startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z" }, { estimatedImpact: cvp.estimatedImpact, avgUnitPrice: cvp.avgUnitPrice, invoiceCount: cvp.invoiceCount }, "Claw back Apex overcharge");

  // 5. verify fail (getPnl with WRONG expected) -> action FAILED, incident untouched (RESOLVED)
  await runChain("getPnl", { orgId: org.id, year: 2024, month: 8 }, { grossProfit: pnl.grossProfit + 12345, grossMargin: 99.99 }, "Recheck August margin", true);

  // 6. verify pass (getPnl, true figures) on already-RESOLVED incident -> RESOLVED -> CLOSED
  const finalStatus = await runChain("getPnl", { orgId: org.id, year: 2024, month: 8 }, { grossProfit: pnl.grossProfit, grossMargin: pnl.grossMargin, revenue: pnl.revenue }, "Confirm August P&L");

  console.log("FINAL incident status:", finalStatus);
  console.log("SMOKE OK");
}

main()
  .catch((e) => {
    console.error("SMOKE FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());