// Bank-statement CSV parser (pure): header/positional layouts, quoted
// fields, per-row errors that never sink the whole file.

import { describe, expect, it } from "vitest";
import { parseBankCsv } from "../lib/connectors/bankCsv";

describe("parseBankCsv", () => {
  it("parses a header-led statement", () => {
    const { rows, errors } = parseBankCsv(
      "date,description,amount,external_id\n" +
        "2024-08-11,Vendor payment AP-202408-APEX-01,-359040,EXT-1\n" +
        "2024-08-12,Customer collection AR-202408-AUTOFAB-01,200000,EXT-2\n"
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: "2024-08-11", description: "Vendor payment AP-202408-APEX-01", amount: -359040, externalId: "EXT-1" },
      { date: "2024-08-12", description: "Customer collection AR-202408-AUTOFAB-01", amount: 200000, externalId: "EXT-2" },
    ]);
  });

  it("handles headerless rows, quoted commas, and $/thousands", () => {
    const { rows, errors } = parseBankCsv(
      '2024-08-28,"Rent August, HQ","-$28,000.00"\n' +
        "2024-08-25,Payroll funding 202408,\"145,000\"\n"
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ description: "Rent August, HQ", amount: -28000 });
    expect(rows[1]).toMatchObject({ amount: 145000 });
    expect(rows[1]).not.toHaveProperty("externalId");
  });

  it("collects row errors without losing good rows", () => {
    const { rows, errors } = parseBankCsv(
      "date,description,amount\n" +
        "2024-08-11,Good row,100\n" +
        "not-a-date,Bad date,50\n" +
        "2024-08-12,,75\n" +
        "2024-08-13,Bad amount,abc\n" +
        "2024-13-45,Impossible date,10\n"
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
  });

  it("rejects a header missing required columns and skips blanks", () => {
    const { rows, errors } = parseBankCsv("day,note\n\n2024-08-11,x\n");
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/missing columns: date, description, amount/);
  });
});
