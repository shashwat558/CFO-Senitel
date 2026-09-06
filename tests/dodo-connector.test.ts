// Dodo Payments connector (read-only): config, pull mapping, webhook
// verification. The SDK client is faked — zero network in this suite.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DodoConnector,
  MAX_PULL_RECORDS,
  getDodoClient,
  minorToMajor,
  resetDodoClient,
  resolveDodoConfig,
} from "../lib/connectors/dodo";
import { ConnectorError } from "../lib/connectors/types";

const PAYMENT = {
  payment_id: "pay_1",
  total_amount: 359040, // paise → ₹3590.40
  currency: "INR",
  settlement_amount: 350000,
  settlement_currency: "INR",
  customer: { customer_id: "cus_1", email: "a@example.com", name: "Acme Buyer" },
  status: "succeeded",
  created_at: "2024-08-11T10:00:00.000Z",
};
const PAYOUT = {
  payout_id: "po_1",
  amount: 500000,
  currency: "INR",
  fee: 5000,
  status: "success",
  created_at: "2024-08-15T10:00:00.000Z",
  updated_at: "2024-08-16T10:00:00.000Z",
};
const REFUND = {
  refund_id: "rf_1",
  payment_id: "pay_1",
  amount: 10000,
  currency: "INR",
  customer: { customer_id: "cus_1", email: "a@example.com", name: "Acme Buyer" },
  status: "succeeded",
  created_at: "2024-08-20T10:00:00.000Z",
};

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    payments: { list: vi.fn(async function* () { yield PAYMENT; }) },
    payouts: { list: vi.fn(async function* () { yield PAYOUT; }) },
    refunds: { list: vi.fn(async function* () { yield REFUND; }) },
    webhooks: { unwrap: vi.fn().mockImplementation((body: string) => JSON.parse(body)) },
    ...overrides,
  };
}

describe("resolveDodoConfig", () => {
  it("throws CONFIG without a key and defaults to test_mode", () => {
    expect(() => resolveDodoConfig({} as NodeJS.ProcessEnv)).toThrow(/DODO_PAYMENTS_API_KEY/);
    try {
      resolveDodoConfig({} as NodeJS.ProcessEnv);
    } catch (e) {
      expect((e as ConnectorError).code).toBe("CONFIG");
    }
    expect(resolveDodoConfig({ DODO_PAYMENTS_API_KEY: "k" })).toMatchObject({
      apiKey: "k",
      environment: "test_mode",
    });
    expect(
      resolveDodoConfig({ DODO_PAYMENTS_API_KEY: "k", DODO_PAYMENTS_ENVIRONMENT: "live_mode" })
    ).toMatchObject({ environment: "live_mode" });
  });
});

describe("getDodoClient", () => {
  beforeEach(() => resetDodoClient());

  it("builds lazily and caches", () => {
    const a = getDodoClient({ apiKey: "k", environment: "test_mode" });
    expect(getDodoClient()).toBe(a);
  });
});

describe("minorToMajor", () => {
  it("converts per-currency decimals and rejects garbage", () => {
    expect(minorToMajor(359040, "INR")).toBe(3590.4);
    expect(minorToMajor(100, "USD")).toBe(1);
    expect(minorToMajor(500, "JPY")).toBe(500);
    expect(() => minorToMajor(Number.NaN, "USD")).toThrow(/non-finite/);
  });
});

describe("DodoConnector.pull", () => {
  it("maps payments, payouts, and refunds oldest-first with a cursor", async () => {
    const c = new DodoConnector({ client: fakeClient() as never });
    const { records, cursor } = await c.pull(new Date("2024-08-01T00:00:00.000Z"));
    expect(records.map((r) => r.kind)).toEqual(["payment", "payout", "refund"]);
    const [pay, payout, refund] = records;
    expect(pay).toMatchObject({
      externalId: "pay_1",
      currency: "INR",
      amount: 3590.4,
      status: "succeeded",
      customer: { externalId: "cus_1" },
    });
    expect(payout).toMatchObject({ externalId: "po_1", amount: 5000 });
    // refunds flow out: negative, like bank outflows
    expect(refund).toMatchObject({ externalId: "rf_1", amount: -100 });
    expect(cursor).toEqual(refund.occurredAt);
    // raw payloads preserved for provenance
    expect(pay.raw).toMatchObject({ payment_id: "pay_1" });
  });

  it("forwards the watermark as created_at_gte and skips corrupt rows", async () => {
    const lists = fakeClient({
      payments: {
        list: vi.fn(async function* () {
          yield PAYMENT;
          yield { payment_id: "", total_amount: 1, currency: "INR", created_at: "2024-08-11T00:00:00.000Z" };
        }),
      },
    });
    const c = new DodoConnector({ client: lists as never });
    const since = new Date("2024-08-01T00:00:00.000Z");
    const { records } = await c.pull(since);
    expect(lists.payments.list).toHaveBeenCalledWith(
      expect.objectContaining({ created_at_gte: since.toISOString() })
    );
    expect(records.filter((r) => r.kind === "payment")).toHaveLength(1);
  });

  it("caps runaway pages and maps SDK failures", async () => {
    async function* infinite() {
      for (;;) yield PAYMENT;
    }
    const c = new DodoConnector({
      client: fakeClient({ payments: { list: vi.fn().mockReturnValue(infinite()) } }) as never,
    });
    const { records } = await c.pull(new Date("2024-08-01T00:00:00.000Z"));
    expect(records.length).toBeLessThanOrEqual(MAX_PULL_RECORDS);

    const failing = new DodoConnector({
      client: fakeClient({
        payments: {
          list: vi.fn(async function* () {
            throw Object.assign(new Error("denied"), { status: 401 });
            yield PAYMENT; // unreachable — keeps the generator shape
          }),
        },
      }) as never,
    });
    await expect(failing.pull(new Date())).rejects.toMatchObject({ name: "ConnectorError" });
    try {
      await failing.pull(new Date());
    } catch (e) {
      expect((e as ConnectorError).code).toBe("AUTH");
    }
  });

  it("rejects an invalid since date", async () => {
    const c = new DodoConnector({ client: fakeClient() as never });
    await expect(c.pull(new Date("nope"))).rejects.toThrow(/valid since date/);
  });
});

describe("DodoConnector.verifyWebhook", () => {
  it("returns the event on valid signature, ok:false on tamper", async () => {
    const body = JSON.stringify({
      type: "payment.succeeded",
      data: { ...PAYMENT, status: "succeeded" },
    });
    const c = new DodoConnector({ client: fakeClient() as never });
    const good = await c.verifyWebhook(body, { "webhook-signature": "sig" });
    expect(good.ok).toBe(true);
    expect(good.eventType).toBe("payment.succeeded");
    expect(good.record).toMatchObject({ externalId: "pay_1", kind: "payment" });

    const bad = new DodoConnector({
      client: fakeClient({
        webhooks: { unwrap: vi.fn().mockRejectedValue(new Error("bad signature")) },
      }) as never,
    });
    const res = await bad.verifyWebhook(body, { "webhook-signature": "wrong" });
    expect(res).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("ignores non-money lifecycle noise with a null record", async () => {
    const c = new DodoConnector({ client: fakeClient() as never });
    const res = await c.verifyWebhook(JSON.stringify({ type: "subscription.renewed", data: {} }), {});
    expect(res.ok).toBe(true);
    expect(res.record).toBeNull();
  });
});

describe("Connector read-only surface", () => {
  it("exposes pull + verify only — no write methods exist", () => {
    const c = new DodoConnector({ client: fakeClient() as never });
    expect(c.id).toBe("dodo");
    expect(typeof c.pull).toBe("function");
    expect(typeof c.verifyWebhook).toBe("function");
    for (const banned of ["create", "update", "delete", "push", "sync", "write"]) {
      expect((c as unknown as Record<string, unknown>)[banned]).toBeUndefined();
    }
  });
});
