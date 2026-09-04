// Prisma seed — persists the deterministic Acme Industries dataset.
// Run: `npx prisma db seed` (configured via package.json `prisma.seed`).
// Idempotent: wipes the Acme org scope first, then recreates identically.

import { PrismaClient } from "@prisma/client";
import { buildDataset } from "../lib/seed/builder";
import { ORG } from "../lib/seed/constants";

const prisma = new PrismaClient();

async function main() {
  const ds = buildDataset();
  console.log(`Seeding ${ds.organization.name} (${ds.organization.slug})...`);

  // Wipe org scope in FK-safe order (children first).
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { orgId: ORG.id } }),
    prisma.approval.deleteMany({ where: { orgId: ORG.id } }),
    prisma.agentStep.deleteMany({ where: { run: { orgId: ORG.id } } }),
    prisma.agentRun.deleteMany({ where: { orgId: ORG.id } }),
    prisma.incidentEvidence.deleteMany({ where: { incident: { orgId: ORG.id } } }),
    prisma.incidentFinding.deleteMany({ where: { incident: { orgId: ORG.id } } }),
    prisma.incidentAction.deleteMany({ where: { incident: { orgId: ORG.id } } }),
    prisma.financialIncident.deleteMany({ where: { orgId: ORG.id } }),
    prisma.transaction.deleteMany({ where: { orgId: ORG.id } }),
    prisma.journalEntry.deleteMany({ where: { orgId: ORG.id } }),
    prisma.invoice.deleteMany({ where: { orgId: ORG.id } }),
    prisma.purchaseOrder.deleteMany({ where: { orgId: ORG.id } }),
    prisma.contract.deleteMany({ where: { orgId: ORG.id } }),
    prisma.account.deleteMany({ where: { orgId: ORG.id } }),
    prisma.customer.deleteMany({ where: { orgId: ORG.id } }),
    prisma.vendor.deleteMany({ where: { orgId: ORG.id } }),
    prisma.user.deleteMany({ where: { orgId: ORG.id } }),
    prisma.organization.deleteMany({ where: { id: ORG.id } }),
  ]);

  await prisma.organization.create({
    data: { id: ds.organization.id, name: ds.organization.name, slug: ds.organization.slug },
  });
  for (const u of ds.users) {
    await prisma.user.create({
      data: { id: u.id, orgId: ORG.id, email: u.email, name: u.name, role: u.role as never },
    });
  }
  for (const v of ds.vendors) {
    await prisma.vendor.create({
      data: { id: v.id, orgId: ORG.id, name: v.name, code: v.code, category: v.category },
    });
  }
  for (const c of ds.customers) {
    await prisma.customer.create({
      data: {
        id: c.id, orgId: ORG.id, name: c.name, code: c.code,
        segment: c.segment, region: c.region,
      },
    });
  }
  for (const a of ds.accounts) {
    await prisma.account.create({
      data: { id: a.id, orgId: ORG.id, code: a.code, name: a.name, type: a.type as never },
    });
  }

  const vendorId = (code: string) => `vendor_${code.toLowerCase()}`;
  const customerId = (code: string) => `customer_${code.toLowerCase()}`;
  const accountId = (code: string) => `acct_${code}`;
  const contractId = (n: string | null) =>
    n ? ds.contracts.find((c) => c.contractNumber === n)?.id ?? null : null;
  const poId = (n: string | null) =>
    n ? ds.purchaseOrders.find((p) => p.poNumber === n)?.id ?? null : null;

  for (const c of ds.contracts) {
    await prisma.contract.create({
      data: {
        id: c.id, orgId: ORG.id, vendorId: vendorId(c.vendorCode),
        contractNumber: c.contractNumber, title: c.title, material: c.material,
        unitOfMeasure: c.unitOfMeasure, unitPrice: c.unitPrice, quantity: c.quantity,
        totalValue: c.totalValue, status: c.status as never,
        startDate: c.startDate, endDate: c.endDate,
      },
    });
  }
  for (const p of ds.purchaseOrders) {
    await prisma.purchaseOrder.create({
      data: {
        id: p.id, orgId: ORG.id, vendorId: vendorId(p.vendorCode),
        contractId: contractId(p.contractNumber), poNumber: p.poNumber,
        status: "BILLED", material: p.material, quantity: p.quantity,
        unitPrice: p.unitPrice, subtotal: p.subtotal, tax: 0, total: p.total,
        currency: "USD", orderDate: p.orderDate, expectedDate: p.expectedDate,
      },
    });
  }
  for (const inv of ds.invoices) {
    await prisma.invoice.create({
      data: {
        id: inv.id, orgId: ORG.id, type: inv.type as never, status: inv.status as never,
        invoiceNumber: inv.invoiceNumber,
        vendorId: inv.vendorCode ? vendorId(inv.vendorCode) : null,
        customerId: inv.customerCode ? customerId(inv.customerCode) : null,
        contractId: contractId(inv.contractNumber),
        purchaseOrderId: poId(inv.poNumber),
        material: inv.material, quantity: inv.quantity, unitPrice: inv.unitPrice,
        subtotal: inv.subtotal, tax: 0, total: inv.total, currency: "USD",
        issueDate: inv.issueDate, dueDate: inv.dueDate,
        paidAt: inv.status === "PAID" ? inv.dueDate : null,
      },
    });
  }

  const jeIdByNumber = new Map(ds.journalEntries.map((j) => [j.entryNumber, j.id]));
  for (const j of ds.journalEntries) {
    await prisma.journalEntry.create({
      data: {
        id: j.id, orgId: ORG.id, entryNumber: j.entryNumber,
        date: j.date, memo: j.memo, source: j.source as never, status: "POSTED",
      },
    });
  }
  const invoiceIdByNumber = new Map(ds.invoices.map((i) => [i.invoiceNumber, `invid_${i.id}`]));
  // Resolve invoice ids: builder ids are the real Prisma ids.
  const invId = new Map(ds.invoices.map((i) => [i.invoiceNumber, i.id]));
  for (const t of ds.transactions) {
    await prisma.transaction.create({
      data: {
        id: t.id,
        orgId: ORG.id,
        journalEntryId: jeIdByNumber.get(t.entryNumber)!,
        accountId: accountId(t.accountCode),
        vendorId: t.vendorCode ? vendorId(t.vendorCode) : null,
        customerId: t.customerCode ? customerId(t.customerCode) : null,
        invoiceId: t.invoiceNumber ? invId.get(t.invoiceNumber) ?? null : null,
        date: t.date,
        debit: t.debit,
        credit: t.credit,
        description: t.description,
      },
    });
  }
  void invoiceIdByNumber;

  const cfo = ds.users[0];
  await prisma.financialIncident.create({
    data: {
      id: ds.incident.id, orgId: ORG.id, title: ds.incident.title,
      description: ds.incident.description, type: ds.incident.type as never,
      status: ds.incident.status as never, severity: ds.incident.severity as never,
      periodStart: ds.incident.periodStart, periodEnd: ds.incident.periodEnd,
      createdById: cfo.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: ORG.id, actorId: null, action: "db.seed",
      entityType: "Organization", entityId: ORG.id,
      metadata: {
        invoices: ds.invoices.length,
        journalEntries: ds.journalEntries.length,
        transactions: ds.transactions.length,
      },
    },
  });

  console.log(
    `Seeded: ${ds.vendors.length} vendors, ${ds.customers.length} customers, ` +
      `${ds.purchaseOrders.length} POs, ${ds.invoices.length} invoices, ` +
      `${ds.journalEntries.length} journal entries, ${ds.transactions.length} lines.`
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
