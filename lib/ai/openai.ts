// OpenAI client factory. The LLM is NEVER used for authoritative financial
// calculations — only for future investigation reasoning (Phase 2+).
// Client is constructed lazily so unit tests / builds without a key succeed.

import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in. " +
        "Deterministic financial services do not need this key."
    );
  }
  if (!cached) cached = new OpenAI({ apiKey });
  return cached;
}

export function getModelName(): string {
  return process.env.MODEL_NAME ?? "gpt-4o-mini";
}
