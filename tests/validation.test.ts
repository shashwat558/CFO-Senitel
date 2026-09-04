import { describe, expect, it } from "vitest";
import { createIncidentSchema } from "../lib/validation/incident";
import { getPnlInput } from "../lib/tools/getPnl";
import { getVendorSpendInput } from "../lib/tools/getVendorSpend";
import { comparePeriodsInput } from "../lib/tools/comparePeriods";
import { getInvoicesInput } from "../lib/tools/getInvoices";
import { calculateFinancialImpactInput } from "../lib/tools/calculateFinancialImpact";

describe("validation boundaries", () => {
  it("rejects incident titles that are too short and unknown types", () => {
    expect(createIncidentSchema.safeParse({ orgId: "o", title: "x" }).success).toBe(false);
    expect(
      createIncidentSchema.safeParse({ orgId: "o", title: "Valid title", type: "NOPE" }).success
    ).toBe(false);
    expect(
      createIncidentSchema.safeParse({ orgId: "o", title: "Why did margin fall in August?" }).success
    ).toBe(true);
  });

  it("getPnl requires a complete period selector", () => {
    expect(getPnlInput.safeParse({ orgId: "o", year: 2024 }).success).toBe(false);
    expect(getPnlInput.safeParse({ orgId: "o", year: 2024, month: 13 }).success).toBe(false);
    expect(getPnlInput.safeParse({ orgId: "o", year: 2024, month: 8 }).success).toBe(true);
    expect(
      getPnlInput.safeParse({
        orgId: "o",
        startDate: "2024-08-01T00:00:00.000Z",
        endDate: "2024-09-01T00:00:00.000Z",
      }).success
    ).toBe(true);
  });

  it("period tools reject bad months and inverted ranges at the schema/service edge", () => {
    expect(
      comparePeriodsInput.safeParse({
        orgId: "o", currentYear: 2024, currentMonth: 8,
        previousYear: 2024, previousMonth: 0, metric: "grossMargin",
      }).success
    ).toBe(false);
    expect(getVendorSpendInput.safeParse({ orgId: "", startDate: "x", endDate: "y" }).success).toBe(
      false
    );
  });

  it("getInvoices caps page size to prevent accidental full-table scans", () => {
    expect(getInvoicesInput.safeParse({ orgId: "o", limit: 500 }).success).toBe(false);
    expect(getInvoicesInput.safeParse({ orgId: "o" }).success).toBe(true);
  });

  it("financial-impact input rejects negative money", () => {
    expect(
      calculateFinancialImpactInput.safeParse({
        orgId: "o", baselineUnitPrice: -5, actualUnitPrice: 10, quantity: 1,
      }).success
    ).toBe(false);
  });
});
