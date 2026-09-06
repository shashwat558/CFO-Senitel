// Connector framework — provider-agnostic surface for real finance apps.
//
// READ-ONLY BY DESIGN: this interface exposes pull (read) and webhook
// verification only. There are deliberately no write/push methods —
// bidirectional sync requires changing this interface, which is a
// product-level decision, never an accident.
//
// Flow: Connector.pull(since) → NormalizedRecord[] → (C2) staging tables →
// (C3) normalize + FX + promote into BankTransaction/Invoice/Customer →
// existing tools read promoted data. The agent never touches raw provider
// output; every promoted row keeps its raw payload for provenance.

/** One normalized external event, regardless of provider. */
export interface NormalizedRecord {
  /** Provider-side stable id (payment_id, payout_id, refund_id, …). */
  externalId: string;
  kind: "payment" | "payout" | "refund" | "subscription";
  occurredAt: Date;
  /** ISO 4217 code as reported by the provider (e.g. INR, USD). */
  currency: string;
  /** Major-unit signed amount (+collection, −refund) in `currency`. */
  amount: number;
  customer: { externalId: string; email: string; name: string } | null;
  /** Provider status string (e.g. succeeded, success). */
  status: string;
  /** Untouched provider payload — provenance for every promoted row. */
  raw: unknown;
}

export interface PullResult {
  records: NormalizedRecord[];
  /** New watermark: callers persist this as the next `since`. */
  cursor: Date;
}

export interface WebhookVerifyResult {
  ok: boolean;
  /** Event type as reported by the provider (e.g. payment.succeeded). */
  eventType?: string;
  /** Normalized record when the event maps to one, else null. */
  record?: NormalizedRecord | null;
  error?: string;
}

export class ConnectorError extends Error {
  readonly code: "CONFIG" | "AUTH" | "RATE_LIMITED" | "NETWORK" | "INVALID_RESPONSE";
  readonly retryable: boolean;
  constructor(
    code: ConnectorError["code"],
    message: string,
    retryable = false
  ) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface Connector {
  readonly id: string;
  readonly displayName: string;
  /**
   * Pull provider events created at/after `since`, oldest first.
   * Pure read — must never create, update, or delete provider-side state.
   */
  pull(since: Date): Promise<PullResult>;
  /** Verify a webhook signature BEFORE parsing; never trust unverified bytes. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<WebhookVerifyResult>;
}
