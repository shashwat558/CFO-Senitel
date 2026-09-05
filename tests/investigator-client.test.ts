import { beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import {
  createInvestigatorClient,
  InvestigatorError,
  resolveModelConfig,
} from "../lib/ai/investigator-client";

function mockClient(completion: unknown, createImpl?: (...args: unknown[]) => unknown) {
  const create = vi.fn(
    createImpl ?? (() => Promise.resolve(completion)),
  );
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

const completionFixture = {
  model: "gpt-4o-mini",
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: JSON.stringify({ hypothesis: "COGS overcharge", confidence: 0.8 }),
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "getPnl", arguments: JSON.stringify({ orgId: "org1" }) },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
};

const req = {
  systemPrompt: "You investigate.",
  userPrompt: "What happened?",
  responseSchema: {
    name: "finding",
    schema: { type: "object", properties: { hypothesis: { type: "string" } } },
  },
};

describe("investigator client", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("resolves model configuration from env with defaults", () => {
    const cfg = resolveModelConfig({ model: "test-model" });
    expect(cfg.model).toBe("test-model");
    expect(cfg.temperature).toBe(0.2);
    expect(cfg.timeoutMs).toBe(60_000);
    process.env.INVESTIGATOR_TEMPERATURE = "0.7";
    expect(resolveModelConfig({ model: "m" }).temperature).toBe(0.7);
    delete process.env.INVESTIGATOR_TEMPERATURE;
  });

  it("makes a structured request and normalizes content + tool calls", async () => {
    const { client, create } = mockClient(completionFixture);
    const res = await createInvestigatorClient({ client }).requestStructured(req);
    expect(res.content).toEqual({ hypothesis: "COGS overcharge", confidence: 0.8 });
    expect(res.toolCalls).toEqual([
      { id: "call_1", name: "getPnl", arguments: JSON.stringify({ orgId: "org1" }), parsedArgs: { orgId: "org1" } },
    ]);
    expect(res.usage?.totalTokens).toBe(30);
    const body = create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    expect(body.messages).toHaveLength(2);
  });

  it("marks malformed tool-call args as null instead of failing", async () => {
    const broken = structuredClone(completionFixture);
    broken.choices[0].message.tool_calls[0].function.arguments = "{oops";
    const { client } = mockClient(broken);
    const res = await createInvestigatorClient({ client }).requestStructured(req);
    expect(res.toolCalls[0].parsedArgs).toBeNull();
    expect(res.content).toEqual({ hypothesis: "COGS overcharge", confidence: 0.8 });
  });

  it("rejects non-JSON content cleanly", async () => {
    const bad = structuredClone(completionFixture);
    bad.choices[0].message.content = "not json at all";
    const { client } = mockClient(bad);
    await expect(createInvestigatorClient({ client }).requestStructured(req)).rejects.toMatchObject({
      name: "InvestigatorError",
      code: "INVALID_RESPONSE",
    });
  });

  it("maps auth/rate-limit/timeout errors to clean codes", async () => {
    const { client } = mockClient(null, () => {
      throw new OpenAI.AuthenticationError(401, { type: "auth", message: "bad key" } as never, "bad", undefined);
    });
    await expect(createInvestigatorClient({ client }).requestStructured(req)).rejects.toMatchObject({ code: "AUTH" });

    const rl = mockClient(null, () => {
      throw new OpenAI.RateLimitError(429, { type: "rl", message: "slow" } as never, "slow", undefined);
    });
    const err = (await createInvestigatorClient({ client: rl.client })
      .requestStructured(req)
      .catch((e: unknown) => e)) as InvestigatorError;
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryable).toBe(true);

    const to = mockClient(null, () => {
      throw new OpenAI.APIConnectionTimeoutError({} as never);
    });
    await expect(createInvestigatorClient({ client: to.client }).requestStructured(req)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("fails cleanly without an API key (env-driven)", async () => {
    const client = createInvestigatorClient(); // no injected client, no env key
    await expect(client.requestStructured(req)).rejects.toMatchObject({ code: "CONFIG" });
  });
});
