// Bank-statement CSV connector, stage 1 (parse + validate only).
//
// Real-app connectors land external records as STAGED rows first: this pure
// parser turns CSV text into validated bank legs plus per-row errors. A later
// slice persists accepted rows as BankTransactions with source=CSV_IMPORT +
// externalId dedupe, then reconciliation links them — the agent only ever
// reads promoted data through tools, never raw connector output.
//
// Expected columns (header row optional): date, description, amount,
// external_id. Dates must be ISO (YYYY-MM-DD); amounts are signed decimal
// (+inflow / −outflow). Malformed rows are collected, never fatal.

import { z } from "zod";

export const bankCsvRowSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be ISO YYYY-MM-DD")
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), {
      message: "date is not a real calendar date",
    }),
  description: z.string().min(1, "description is required").max(500),
  amount: z.number().finite("amount must be a finite number"),
  externalId: z.string().min(1).max(200).optional(),
});

export type BankCsvRow = z.infer<typeof bankCsvRowSchema>;

export interface BankCsvError {
  line: number;
  message: string;
}

export interface BankCsvResult {
  rows: BankCsvRow[];
  errors: BankCsvError[];
}

const MAX_ROWS = 5000;

/** Split one CSV line respecting double-quoted fields. */
function splitLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\$/g, "").replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseBankCsv(text: string): BankCsvResult {
  const rows: BankCsvRow[] = [];
  const errors: BankCsvError[] = [];
  const lines = text.split(/\r?\n/);
  let idx: Record<string, number> | null = null;
  let lineNo = 0;

  for (const rawLine of lines) {
    lineNo++;
    if (rawLine.trim() === "") continue;
    const fields = splitLine(rawLine);
    if (!idx) {
      // Header row when the first cell is not a date (case-insensitive).
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[0])) {
        const lower = fields.map((f) => f.toLowerCase());
        const need = ["date", "description", "amount"];
        const missing = need.filter((n) => !lower.includes(n));
        if (missing.length > 0) {
          errors.push({ line: lineNo, message: `missing columns: ${missing.join(", ")}` });
          return { rows, errors };
        }
        idx = {
          date: lower.indexOf("date"),
          description: lower.indexOf("description"),
          amount: lower.indexOf("amount"),
          external: lower.indexOf("external_id"),
        };
        continue;
      }
      idx = { date: 0, description: 1, amount: 2, external: 3 };
    }
    if (rows.length + errors.length >= MAX_ROWS) {
      errors.push({ line: lineNo, message: `row cap exceeded (${MAX_ROWS})` });
      break;
    }
    const amount = parseAmount(fields[idx.amount] ?? "");
    const parsed = bankCsvRowSchema.safeParse({
      date: fields[idx.date] ?? "",
      description: fields[idx.description] ?? "",
      amount: amount ?? Number.NaN,
      ...(idx.external >= 0 && (fields[idx.external] ?? "") !== ""
        ? { externalId: fields[idx.external] }
        : {}),
    });
    if (!parsed.success) {
      errors.push({ line: lineNo, message: parsed.error.issues[0]?.message ?? "invalid row" });
      continue;
    }
    rows.push(parsed.data);
  }
  return { rows, errors };
}
