// Dodo Payments connector (read-only pull + webhook verification).
//
// Single-company scope: one key set from the environment (test_mode default).
// Amounts arrive in minor units — minorToMajor() converts per-currency.
// The client is constructed lazily so typecheck/build/tests pass with no key,
// and injectable so tests never touch the network.

import { DodoPayments } from "dodopayments";
import {
  ConnectorError,
  type Connector,
  type NormalizedRecord,
  type PullResult,
  type WebhookVerifyResult,
} from "./types";

export type DodoEnvironment = "test_mode" | "live_mode";

export interface DodoConfig {
  apiKey: string;
  environment: DodoEnvironment;
  webhookKey?: string;
}

const CONFIG_HELP =
  "DODO_PAYMENTS_API_KEY is not set. Add it to .env (test_mode key from " +
  "Developer > API Keys in the Dodo dashboard). Connector pulls stay disabled " +
  "until then — deterministic services and the seeded demo do not need it.";

/** Resolve config from the environment. Throws CONFIG when keyless. */
export function resolveDodoConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<DodoConfig> = {}
): DodoConfig {
  const apiKey = overrides.apiKey ?? env.DODO_PAYMENTS_API_KEY ?? "";
  if (!apiKey) throw new ConnectorError("CONFIG", CONFIG_HELP, false);
  const rawEnv = overrides.environment ?? env.DODO_PAYMENTS_ENVIRONMENT ?? "test_mode";
  const environment: DodoEnvironment = rawEnv === "live_mode" ? "live_mode" : "test_mode";
  return {
    apiKey,
    environment,
    webhookKey: overrides.webhookKey ?? env.DODO_PAYMENTS_WEBHOOK_KEY ?? undefined,
  };
}

let cached: DodoPayments | null = null;

/** Lazily build (and cache) the SDK client. Inject one in tests instead. */
export function getDodoClient(config?: DodoConfig): DodoPayments {
  if (!cached) {
    const resolved = config ?? resolveDodoConfig();
    cached = new DodoPayments({
      bearerToken: resolved.apiKey,
      environment: resolved.environment,
    });
  }
  return cached;
}

/** For tests: reset the cached client between cases. */
export function resetDodoClient(): void {
  cached = null;
}

// Minor-unit decimal places per ISO 4217 code (default 2).
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);

/** Convert provider minor units to major units (never loses the raw value). */
export function minorToMajor(amountMinor: number, currency: string): number {
  if (!Number.isFinite(amountMinor)) {
    throw new ConnectorError("INVALID_RESPONSE", `non-finite amount: ${String(amountMinor)}`, false);
  }
  const decimals = ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
  return amountMinor / 10 ** decimals;
}

/** Safety bound: one pull never streams more than this many records. */
export const MAX_PULL_RECORDS = 2000;

interface DodoCustomer {
  customer_id?: unknown;
  email?: unknown;
  name?: unknown;
}

function toCustomer(c: DodoCustomer | null | undefined): NormalizedRecord["customer"] {
  if (!c || typeof c.customer_id !== "string" || !c.customer_id) return null;
  return {
    externalId: c.customer_id,
    email: typeof c.email === "string" ? c.email : "",
    name: typeof c.name === "string" ? c.name : "",
  };
}

type MinimalClient = {
  payments: { list(params?: unknown): AsyncIterable<Record<string, unknown>> };
  payouts: { list(params?: unknown): AsyncIterable<Record<string, unknown>> };
  refunds: { list(params?: unknown): AsyncIterable<Record<string, unknown>> };
  webhooks: { unwrap(body: string, opts: { headers: Record<string, string>; key?: string }): unknown };
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mapPayment(p: Record<string, unknown>): NormalizedRecord | null {
  const id = str(p.payment_id);
  const created = str(p.created_at);
  const total = num(p.total_amount);
  const currency = str(p.currency) || "USD";
  const ts = new Date(created).getTime();
  if (!id || !created || Number.isNaN(ts) || total === null) return null; // skip, never fabricate
  return {
    externalId: id,
    kind: "payment",
    occurredAt: new Date(created),
    currency,
    amount: minorToMajor(total, currency),
    customer: toCustomer(p.customer as DodoCustomer | null),
    status: str(p.status) || "unknown",
    raw: p,
  };
}

function mapPayout(p: Record<string, unknown>): NormalizedRecord | null {
  const id = str(p.payout_id);
  const created = str(p.created_at);
  const amount = num(p.amount);
  const currency = str(p.currency) || "USD";
  const ts = new Date(created).getTime();
  if (!id || !created || Number.isNaN(ts) || amount === null) return null;
  return {
    externalId: id,
    kind: "payout",
    occurredAt: new Date(created),
    currency,
    amount: minorToMajor(amount, currency),
    customer: null,
    status: str(p.status) || "unknown",
    raw: p,
  };
}

function mapRefund(r: Record<string, unknown>): NormalizedRecord | null {
  const id = str(r.refund_id);
  const created = str(r.created_at);
  const amount = num(r.amount);
  const currency = str(r.currency) || "USD";
  const ts = new Date(created).getTime();
  if (!id || !created || Number.isNaN(ts) || amount === null) return null;
  return {
    externalId: id,
    kind: "refund",
    occurredAt: new Date(created),
    currency,
    // Refunds flow OUT of the merchant: stored negative, like bank outflows.
    amount: -minorToMajor(amount, currency),
    customer: toCustomer(r.customer as DodoCustomer | null),
    status: str(r.status) || "unknown",
    raw: r,
  };
}

export class DodoConnector implements Connector {
  readonly id = "dodo";
  readonly displayName = "Dodo Payments";

  constructor(private readonly deps: { client?: DodoPayments; config?: DodoConfig } = {}) {}

  private client(): MinimalClient {
    if (this.deps.client) return this.deps.client as unknown as MinimalClient;
    return getDodoClient(this.deps.config) as unknown as MinimalClient;
  }

  async pull(since: Date): Promise<PullResult> {
    if (Number.isNaN(since.getTime())) {
      throw new ConnectorError("CONFIG", "pull requires a valid since date", false);
    }
    const client = this.client();
    const iso = since.toISOString();
    const records: NormalizedRecord[] = [];
    const push = (r: NormalizedRecord | null) => {
      if (r && records.length < MAX_PULL_RECORDS) records.push(r);
    };
    try {
      for await (const p of client.payments.list({ created_at_gte: iso })) {
        if (records.length >= MAX_PULL_RECORDS) break;
        push(mapPayment(p));
      }
      for await (const p of client.payouts.list({ created_at_gte: iso })) {
        if (records.length >= MAX_PULL_RECORDS) break;
        push(mapPayout(p));
      }
      for await (const r of client.refunds.list({ created_at_gte: iso })) {
        if (records.length >= MAX_PULL_RECORDS) break;
        push(mapRefund(r));
      }
    } catch (err) {
      throw mapSdkError(err);
    }
    records.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const cursor =
      records.length > 0 ? records[records.length - 1].occurredAt : since;
    return { records, cursor };
  }

  async verifyWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<WebhookVerifyResult> {
    const client = this.client();
    const key = this.deps.config?.webhookKey ?? process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    try {
      const event = (await client.webhooks.unwrap(rawBody, {
        headers,
        ...(key ? { key } : {}),
      })) as { type?: string; data?: Record<string, unknown> };
      const record = mapWebhookEvent(event);
      return { ok: true, eventType: event.type, record };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Map the small set of money-moving webhook events; everything else → null record. */
function mapWebhookEvent(event: {
  type?: string;
  data?: Record<string, unknown>;
}): NormalizedRecord | null {
  const data = event.data ?? {};
  switch (event.type) {
    case "payment.succeeded":
      return mapPayment({ ...data, status: "succeeded" });
    case "payout.success":
      return mapPayout({ ...data, status: "success" });
    case "refund.succeeded":
      return mapRefund({ ...data, status: "succeeded" });
    default:
      return null; // lifecycle noise (processing, holds, subscription churn) — C2 stages it raw
  }
}

function mapSdkError(err: unknown): ConnectorError {
  if (err instanceof ConnectorError) return err;
  const anyErr = err as { status?: number; message?: string };
  if (typeof anyErr?.status === "number") {
    if (anyErr.status === 401 || anyErr.status === 403) {
      return new ConnectorError("AUTH", "Dodo authentication failed. Check DODO_PAYMENTS_API_KEY.", false);
    }
    if (anyErr.status === 429) {
      return new ConnectorError("RATE_LIMITED", "Dodo rate limit exceeded", true);
    }
    if (anyErr.status >= 500) {
      return new ConnectorError("NETWORK", `Dodo server error (${anyErr.status})`, true);
    }
  }
  return new ConnectorError(
    "NETWORK",
    err instanceof Error ? err.message : "Unknown Dodo request failure",
    false
  );
}
