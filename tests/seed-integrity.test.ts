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
    // 60 AP + 120 AR + 36 opex journal entries
    expect(ds.journalEntries).toHaveLength(216);
    // every entry has exactly 2 balanced lines
    expect(ds.transactions).toHaveLength(432);
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

  it("August gross margin is materially below July (the demo question is answerable)", () => {
    const pnl = (monthIdx: number) => {
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
});
