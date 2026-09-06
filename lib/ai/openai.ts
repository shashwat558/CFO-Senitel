// LLM client factory (OpenAI-compatible). The LLM is NEVER used for
// authoritative financial calculations — only for investigation reasoning.
// Default backend is Groq's free tier (no key needed for anything else):
//   GROQ_API_KEY + OPENAI_BASE_URL=https://api.groq.com/openai/v1 +
//   MODEL_NAME=llama-3.3-70b-versatile.
// Point OPENAI_BASE_URL at https://api.openai.com/v1 with an OpenAI key to go
// back to OpenAI. Client is constructed lazily so unit tests / builds without
// a key succeed.

import OpenAI from "openai";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENAI_BASE_URL_DEFAULT = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "llama-3.3-70b-versatile";

let cached: OpenAI | null = null;
let cachedKey: string | null = null;

function resolveApiKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.GROQ_API_KEY ?? env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "No LLM API key is set. For the free default backend, sign up at " +
        "https://console.groq.com (no credit card), create an API key, and set " +
        "GROQ_API_KEY in .env — see .env.example. " +
        "Deterministic financial services do not need this key."
    );
  }
  return key;
}

export function getBaseURL(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_BASE_URL ?? GROQ_BASE_URL;
}

export function getOpenAIClient(): OpenAI {
  const apiKey = resolveApiKey();
  if (!cached || cachedKey !== apiKey + getBaseURL()) {
    cached = new OpenAI({ apiKey, baseURL: getBaseURL() });
    cachedKey = apiKey + getBaseURL();
  }
  return cached;
}

/** For tests: drop the cached client between cases. */
export function resetOpenAIClient(): void {
  cached = null;
  cachedKey = null;
}

export function getModelName(): string {
  return process.env.MODEL_NAME ?? DEFAULT_MODEL;
}
