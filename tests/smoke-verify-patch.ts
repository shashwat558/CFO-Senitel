/* Smoke test (run with tsx against a live seeded DB) — not part of the suite.
 * Exercises the real services end-to-end:
 *   PATCH statusing + assignment → propose/approve/execute → verifyAction
 *   (re-queries getPnl + compareVendorPrices, auto RESOLVED → CLOSED).
 * Tenant + actor come from the v1 session stub: getSession resolves the
 * seeded default user (Maya Chen, CFO) and every service call is org-scoped
 * to session.user.orgId with the session user as the audit actor + decider.
 */
import { prisma } from "../lib/db/prisma";
import { getSession } from "../lib/auth/session";
import { updateIncident } from "../lib/services/incidents";
import { proposeAction, executeAction } from "../lib/services/actions";
import { decideApproval } from "../lib/services/approvals";
import { verifyAction } from "../lib/verification/runner";
import { compareVendorPricesTool } from "../lib/tools/compareVendorPrices";
import { getPnlTool } from "../lib/tools/getPnl";

async function main() {
  const { user: cfo } = await getSession(prisma);
  const orgId = cfo.orgId;
  const incident = await prisma.financialIncident.findFirstOrThrow();
  const incidentId = incident.id;
  const controller = await prisma.user.findFirstOrThrow({ where: { orgId, role: "CONTROLLER" } });
  const opts = { actorId: cfo.id };

  // 1. PATCH: OPEN → INVESTIGATING + assignment (real transition + assignee)
  const investigating = await updateIncident(prisma, orgId, incidentId, {
    status: "INVESTIGATING",
    assignedToId: controller.id,
  }, opts);
  console.log("PATCH OPEN->INVESTIGATING+assign:", investigating.status, "| assignedTo:", investigating.assignedToId);

  // 2. PATCH: move to PENDING_APPROVAL so verify can auto-resolve
  const pending = await updateIncident(prisma, orgId, incidentId, { status: "PENDING_APPROVAL" }, opts);
  console.log("PATCH INVESTIGATING->PENDING_APPROVAL:", pending.status);

  // 3. Invalid transition must be a 400-class ValidationError
  try {
    await updateIncident(prisma, orgId, incidentId, { status: "OPEN" }, opts);
    console.log("UNEXPECTED: PENDING_APPROVAL->OPEN allowed");
  } catch (e) {
    console.log("PATCH PENDING_APPROVAL->OPEN: rejected ->", (e as Error).message);
  }

  // Fresh evidence for expected figures (real tool calls, Aug 2024 Apex)
  const cvp = await compareVendorPricesTool.execute(
    { orgId, vendorId: "vendor_apex", startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z" },
    { db: prisma, orgId, audit: false }
  );
  const pnl = await getPnlTool.execute(
    { orgId, year: 2024, month: 8 },
    { db: prisma, orgId, audit: false }
  );
  console.log("fresh compareVendorPrices:", { estimatedImpact: cvp.estimatedImpact, avgUnitPrice: cvp.avgUnitPrice, invoiceCount: cvp.invoiceCount });
  console.log("fresh getPnl:", { grossProfit: pnl.grossProfit, grossMargin: pnl.grossMargin, revenue: pnl.revenue });

  const finding = await prisma.incidentFinding.create({
    data: { incidentId, title: "Apex overcharge drives margin decline", rank: 1, confidence: 0.9 },
  });

  const runChain = async (toolName: string, input: Record<string, unknown>, expected: Record<string, unknown>, title: string, wrong = false) => {
    const { action, approval } = await proposeAction(prisma, orgId, {
      incidentId,
      findingId: finding.id,
      title,
      payload: { verification: { toolName, input, expected } },
    }, opts);
    const { action: approved } = await decideApproval(prisma, orgId, {
      approvalId: approval.id,
      decision: "APPROVED",
      decidedById: cfo.id,
      reason: "smoke",
    });
    if (!approved) throw new Error("smoke: approval did not update the action");
    const executed = await executeAction(prisma, orgId, approved.id, { actor: { id: cfo.id, role: cfo.role } });
    const out = await verifyAction(prisma, orgId, executed.id, opts);
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
  await runChain("compareVendorPrices", { orgId, vendorId: "vendor_apex", startDate: "2024-08-01T00:00:00.000Z", endDate: "2024-09-01T00:00:00.000Z" }, { estimatedImpact: cvp.estimatedImpact, avgUnitPrice: cvp.avgUnitPrice, invoiceCount: cvp.invoiceCount }, "Claw back Apex overcharge");

  // 5. verify fail (getPnl with WRONG expected) -> action FAILED, incident untouched (RESOLVED)
  await runChain("getPnl", { orgId, year: 2024, month: 8 }, { grossProfit: pnl.grossProfit + 12345, grossMargin: 99.99 }, "Recheck August margin", true);

  // 6. verify pass (getPnl, true figures) on already-RESOLVED incident -> RESOLVED -> CLOSED
  const finalStatus = await runChain("getPnl", { orgId, year: 2024, month: 8 }, { grossProfit: pnl.grossProfit, grossMargin: pnl.grossMargin, revenue: pnl.revenue }, "Confirm August P&L");

  console.log("FINAL incident status:", finalStatus);
  console.log("SMOKE OK");
}

main()
  .catch((e) => {
    console.error("SMOKE FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());