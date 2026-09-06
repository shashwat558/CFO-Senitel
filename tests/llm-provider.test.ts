// LLM provider wiring: Groq free tier by default, OpenAI opt-in.
// No network in this suite — asserts resolution, caching, and model default.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  GROQ_BASE_URL,
  getBaseURL,
  getModelName,
  getOpenAIClient,
  resetOpenAIClient,
} from "../lib/ai/openai";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

afterEach(() => {
  resetOpenAIClient();
  vi.unstubAllEnvs();
});

describe("LLM provider wiring", () => {
  it("defaults to the Groq free tier", () => {
    expect(GROQ_BASE_URL).toBe("https://api.groq.com/openai/v1");
    expect(DEFAULT_MODEL).toBe("llama-3.3-70b-versatile");
    delete process.env.OPENAI_BASE_URL;
    expect(getBaseURL()).toBe(GROQ_BASE_URL);
  });

  it("honors an explicit base URL for the OpenAI fallback", () => {
    expect(getBaseURL({ OPENAI_BASE_URL: "https://api.openai.com/v1" })).toBe(
      "https://api.openai.com/v1"
    );
  });

  it("prefers GROQ_API_KEY, falls back to OPENAI_API_KEY, else names both", () => {
    const clientFor = (env: Record<string, string | undefined>) => {
      resetOpenAIClient();
      const savedG = process.env.GROQ_API_KEY;
      const savedO = process.env.OPENAI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.OPENAI_API_KEY;
      Object.assign(process.env, env);
      try {
        return getOpenAIClient();
      } finally {
        delete process.env.GROQ_API_KEY;
        delete process.env.OPENAI_API_KEY;
        if (savedG !== undefined) process.env.GROQ_API_KEY = savedG;
        if (savedO !== undefined) process.env.OPENAI_API_KEY = savedO;
      }
    };
    expect((clientFor({ GROQ_API_KEY: "gsk_x" }) as unknown as { apiKey: string }).apiKey).toBe(
      "gsk_x"
    );
    expect((clientFor({ OPENAI_API_KEY: "sk_x" }) as unknown as { apiKey: string }).apiKey).toBe(
      "sk_x"
    );
    expect(() => clientFor({})).toThrow(/GROQ_API_KEY/);
    expect(() => clientFor({})).toThrow(/console\.groq\.com/);
  });

  it("caches per key+endpoint and resets on demand", () => {
    withEnv({ GROQ_API_KEY: "gsk_a" }, () => {
      const a = getOpenAIClient();
      expect(getOpenAIClient()).toBe(a);
      resetOpenAIClient();
      expect(getOpenAIClient()).not.toBe(a);
    });
  });

  it("defaults the model to llama-3.3-70b-versatile, MODEL_NAME wins", () => {
    withEnv({ MODEL_NAME: undefined as unknown as string }, () => {
      delete process.env.MODEL_NAME;
      expect(getModelName()).toBe("llama-3.3-70b-versatile");
    });
    withEnv({ MODEL_NAME: "gpt-4o-mini" }, () => {
      expect(getModelName()).toBe("gpt-4o-mini");
    });
  });
});
