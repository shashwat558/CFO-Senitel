import { describe, expect, it } from "vitest";
import { buildDataset } from "../lib/seed/builder";
import { INCIDENT, VENDORS } from "../lib/seed/constants";
import { calculateGrossMargin } from "../lib/financial/calculations";

describe("seed integrity (no DB required — tests the builder)", () => {
  const ds = buildDataset();

  it("is deterministic: two builds are byte-identical", () => {
    const a = JSON.stringify(buildDataset(42));
    const b = JSON.stringify(buildDataset(42));
    expect(a).toBe(b);
  });

  it("covers 12 months with expected row counts", () => {
    expect(ds.purchaseOrders).toHaveLength(5 * 12); // 5 vendors × 12 months
    expect(ds.invoices.filter((i) => i.type === "AP")).toHaveLength(60);
    expect(ds.invoices.filter((i) => i.type === "AR")).toHaveLength(120);
    // 60 AP + 120 AR + 36 opex + 135 settlement (one per PAID invoice) entries
    expect(ds.journalEntries).toHaveLength(216 + 135);
    // every entry has exactly 2 balanced lines
    expect(ds.transactions).toHaveLength(432 + 270);
  });

  it("every journal entry balances (sum debit == sum credit)", () => {
    const byEntry = new Map<string, { d: number; c: number; n: number }>();
    for (const t of ds.transactions) {
      const cur = byEntry.get(t.entryNumber) ?? { d: 0, c: 0, n: 0 };
      cur.d += t.debit;
      cur.c += t.credit;
      cur.n += 1;
      byEntry.set(t.entryNumber, cur);
    }
    expect(byEntry.size).toBe(ds.journalEntries.length);
    for (const [n, v] of byEntry) {
      expect(v.n).toBe(2);
      expect(Math.abs(v.d - v.c)).toBeLessThan(0.005);
    }
  });

  it("maintains Vendor → Contract → PO → Invoice relationships", () => {
    const contracts = new Set(ds.contracts.map((c) => c.contractNumber));
    const pos = new Set(ds.purchaseOrders.map((p) => p.poNumber));
    for (const inv of ds.invoices.filter((i) => i.type === "AP")) {
      expect(inv.vendorCode).toBeTruthy();
      expect(contracts.has(inv.contractNumber!)).toBe(true);
      expect(pos.has(inv.poNumber!)).toBe(true);
      // invoice price/qty matches its PO (single-line POs)
      const po = ds.purchaseOrders.find((p) => p.poNumber === inv.poNumber)!;
      expect(inv.unitPrice).toBe(po.unitPrice);
      expect(inv.quantity).toBe(po.quantity);
    }
    // every transaction references a real account and journal entry
    const accts = new Set(ds.accounts.map((a) => a.code));
    const jes = new Set(ds.journalEntries.map((j) => j.entryNumber));
    for (const t of ds.transactions) {
      expect(accts.has(t.accountCode)).toBe(true);
      expect(jes.has(t.entryNumber)).toBe(true);
    }
  });

  it("injects the August Apex Steel price spike in data (not in app logic)", () => {
    const apex = VENDORS.find((v) => v.code === INCIDENT.vendorCode)!;
    const augInv = ds.invoices.find(
      (i) => i.type === "AP" && i.vendorCode === "APEX" && i.issueDate.getUTCMonth() === 7
    )!;
    const julInv = ds.invoices.find(
      (i) => i.type === "AP" && i.vendorCode === "APEX" && i.issueDate.getUTCMonth() === 6
    )!;
    expect(augInv.unitPrice! / apex.contractUnitPrice).toBeCloseTo(INCIDENT.priceMultiplier, 1);
    expect(julInv.unitPrice! / apex.contractUnitPrice).toBeCloseTo(1, 1);
  });

  it("August gross margin is materially below July (the demo question is answerable)", () => {    const pnl = (monthIdx: number) => {
      let rev = 0;
      let cogs = 0;
      for (const inv of ds.invoices) {
        if (inv.issueDate.getUTCMonth() !== monthIdx) continue;
        if (inv.type === "AR") rev += inv.total;
        if (inv.type === "AP") cogs += inv.total;
      }
      return { rev, cogs, margin: calculateGrossMargin(rev, cogs) };
    };
    const jul = pnl(6);
    const aug = pnl(7);
    expect(aug.margin).toBeLessThan(jul.margin - 4); // ≥4pp drop
  });

  it("settles every PAID invoice through cash with P&L-neutral legs", () => {
    const paid = ds.invoices.filter((i) => i.status === "PAID");
    expect(paid.length).toBeGreaterThan(0);
    const settleJes = new Set(
      ds.journalEntries.filter((j) => /^(Settle|Collect) /.test(j.memo)).map((j) => j.entryNumber)
    );
    expect(settleJes.size).toBe(paid.length);
    // settlement legs touch only balance-sheet accounts (P&L untouched)
    for (const t of ds.transactions) {
      if (settleJes.has(t.entryNumber)) {
        expect(["1000", "1100", "2000"]).toContain(t.accountCode);
      }
    }
  });

  it("mirrors settlement 1:1 in bank legs with exact amounts", () => {
    expect(ds.bankAccounts).toHaveLength(2);
    const byExt = new Map(ds.bankTransactions.map((b) => [b.externalId, b]));
    // every PAID invoice has exactly one invoice-linked bank leg for its total
    for (const inv of ds.invoices.filter((i) => i.status === "PAID")) {
      const leg = byExt.get(`EXT-${inv.invoiceNumber}`)!;
      expect(leg).toBeDefined();
      expect(Math.abs(leg.amount)).toBe(inv.total);
      expect(leg.amount > 0).toBe(inv.type === "AR");
      expect(leg.glTransactionId).toBeTruthy();
    }
    // bank external ids are unique per account
    const keys = ds.bankTransactions.map((b) => `${b.bankCode}:${b.externalId}`);
    expect(new Set(keys).size).toBe(keys.length);
    // pre-September legs ship reconciled; August/September stay pending
    const pending = ds.bankTransactions.filter((b) => b.status === "PENDING");
    const reconciled = ds.bankTransactions.filter((b) => b.status === "RECONCILED");
    expect(pending.length).toBeGreaterThan(0);
    expect(reconciled.length).toBeGreaterThan(0);
    for (const b of reconciled.filter((x) => x.invoiceNumber)) {
      expect(b.date < new Date(Date.UTC(2024, 8, 1))).toBe(true);
    }
  });

  it("seeds monthly budgets and BASE forecasts from the same constants", () => {
    // 6 accounts × 12 months; 3 metrics × 12 months
    expect(ds.budgets).toHaveLength(72);
    expect(ds.forecasts).toHaveLength(36);
    expect(new Set(ds.forecasts.map((f) => f.scenario))).toEqual(new Set(["BASE"]));
    const janRev = ds.budgets.find((b) => b.accountCode === "4000" && b.month === 1)!;
    expect(janRev.amount).toBe(1200000);
    const janFc = ds.forecasts.find((f) => f.metric === "REVENUE" && f.month === 1)!;
    expect(janFc.amount).toBe(1200000);
    // budget/forecast ids are unique
    expect(new Set(ds.budgets.map((b) => b.id)).size).toBe(72);
    expect(new Set(ds.forecasts.map((f) => f.id)).size).toBe(36);
  });
});
