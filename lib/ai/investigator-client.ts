// OpenAI Investigator Client — thin LLM transport layer for the future
// Investigator Agent. Deliberately free of business logic: no financial
// calculations, no tool execution, no investigation loop. It only:
//   - resolves model configuration from the environment,
//   - makes structured chat-completion requests (JSON Schema + tool calls),
//   - normalizes tool-call responses,
//   - maps errors and enforces timeouts.

import OpenAI from "openai";
import { z } from "zod";
import { getModelName, getOpenAIClient } from "./openai";

// ---------------------------------------------------------------------------
// Model configuration (environment-driven).
// ---------------------------------------------------------------------------

const modelConfigSchema = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0).max(5),
});

export type InvestigatorModelConfig = z.infer<typeof modelConfigSchema>;

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Resolve model configuration from the environment with safe defaults. */
export function resolveModelConfig(
  overrides: Partial<InvestigatorModelConfig> = {},
): InvestigatorModelConfig {
  return modelConfigSchema.parse({
    model: overrides.model ?? getModelName(),
    temperature: overrides.temperature ?? numFromEnv("INVESTIGATOR_TEMPERATURE", 0.2),
    maxTokens: overrides.maxTokens ?? numFromEnv("INVESTIGATOR_MAX_TOKENS", 2000),
    timeoutMs: overrides.timeoutMs ?? numFromEnv("INVESTIGATOR_TIMEOUT_MS", 60_000),
    maxRetries: overrides.maxRetries ?? numFromEnv("INVESTIGATOR_MAX_RETRIES", 2),
  });
}

// ---------------------------------------------------------------------------
// Types: structured request / tool-call response.
// ---------------------------------------------------------------------------

export interface StructuredResponseSchema {
  /** Name of the JSON Schema object the model must conform to. */
  name: string;
  /** Plain JSON Schema (caller's zod->JSON conversion lives outside). */
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface StructuredRequest {
  systemPrompt: string;
  userPrompt: string;
  responseSchema: StructuredResponseSchema;
  /** OpenAI `tools` array (e.g. from lib/tools/openai.ts getOpenAITools). */
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  config?: Partial<InvestigatorModelConfig>;
}

export interface InvestigatorToolCall {
  id: string;
  name: string;
  /** Raw arguments string exactly as returned by the model. */
  arguments: string;
  /** Best-effort parsed arguments; null when the JSON is malformed. */
  parsedArgs: unknown;
}

export interface StructuredResponse {
  /** Parsed JSON content conforming to the requested schema (null on refusal). */
  content: unknown;
  toolCalls: InvestigatorToolCall[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  model: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export type InvestigatorErrorCode =
  | "CONFIG"
  | "AUTH"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "BAD_REQUEST"
  | "SERVER"
  | "NETWORK"
  | "INVALID_RESPONSE";

export class InvestigatorError extends Error {
  readonly code: InvestigatorErrorCode;
  readonly retryable: boolean;
  constructor(code: InvestigatorErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "InvestigatorError";
    this.code = code;
    this.retryable = retryable;
  }
}

function mapError(err: unknown): InvestigatorError {
  if (err instanceof InvestigatorError) return err;
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new InvestigatorError("TIMEOUT", "OpenAI request timed out", true);
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return new InvestigatorError("AUTH", "OpenAI authentication failed. Check OPENAI_API_KEY.", false);
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new InvestigatorError("RATE_LIMITED", "OpenAI rate limit exceeded", true);
  }
  if (err instanceof OpenAI.BadRequestError) {
    return new InvestigatorError("BAD_REQUEST", `OpenAI rejected the request: ${err.message}`, false);
  }
  if (err instanceof OpenAI.InternalServerError) {
    return new InvestigatorError("SERVER", `OpenAI server error: ${err.message}`, true);
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new InvestigatorError("NETWORK", `OpenAI connection failed: ${err.message}`, true);
  }
  if (err instanceof OpenAI.APIError) {
    const retryable = err.status !== undefined && err.status >= 500;
    return new InvestigatorError(retryable ? "SERVER" : "BAD_REQUEST", `OpenAI error (${err.status}): ${err.message}`, retryable);
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return new InvestigatorError("TIMEOUT", "OpenAI request aborted (timeout)", true);
  }
  if (err instanceof Error && /OPENAI_API_KEY/.test(err.message)) {
    return new InvestigatorError("CONFIG", err.message, false);
  }
  return new InvestigatorError(
    "NETWORK",
    err instanceof Error ? err.message : "Unknown OpenAI request failure",
    false,
  );
}

// ---------------------------------------------------------------------------
// Client.
// ---------------------------------------------------------------------------

export interface InvestigatorClientOptions {
  /** Inject a pre-built client (tests); otherwise resolved lazily from env. */
  client?: OpenAI;
  config?: Partial<InvestigatorModelConfig>;
}

function safeParseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeParseContent(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvestigatorError(
      "INVALID_RESPONSE",
      "Model returned non-JSON content for a structured request",
      false,
    );
  }
}

export class InvestigatorClient {
  private readonly injected: OpenAI | null;
  private readonly baseConfig: Partial<InvestigatorModelConfig>;

  constructor(opts: InvestigatorClientOptions = {}) {
    this.injected = opts.client ?? null;
    this.baseConfig = opts.config ?? {};
  }

  private resolveClient(): OpenAI {
    // Throws a clear CONFIG-style error when OPENAI_API_KEY is missing.
    return this.injected ?? getOpenAIClient();
  }

  /**
   * Make a structured request: the model MUST return JSON matching
   * `responseSchema`, and MAY return tool calls. Transport only — no
   * business logic, no tool execution, no follow-up loop.
   */
  async requestStructured(req: StructuredRequest, signal?: AbortSignal): Promise<StructuredResponse> {
    const config = resolveModelConfig({ ...this.baseConfig, ...req.config });
    let client: OpenAI;
    try {
      client = this.resolveClient();
    } catch (err) {
      throw mapError(err);
    }

    const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
    const combined = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await client.chat.completions.create(
        {
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: req.responseSchema.name,
              schema: req.responseSchema.schema,
              strict: req.responseSchema.strict ?? true,
            },
          },
          ...(req.tools ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" } : {}),
        },
        { signal: combined, timeout: config.timeoutMs, maxRetries: config.maxRetries },
      );
    } catch (err) {
      if (combined.aborted) {
        throw new InvestigatorError("TIMEOUT", "OpenAI request timed out", true);
      }
      throw mapError(err);
    }

    const choice = completion.choices[0];
    if (!choice) {
      throw new InvestigatorError("INVALID_RESPONSE", "OpenAI returned no choices", true);
    }
    const message = choice.message;

    const toolCalls: InvestigatorToolCall[] = (message.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        parsedArgs: safeParseArgs(tc.function.arguments),
      }));

    const refusal = (message as { refusal?: unknown }).refusal;
    const content = refusal != null ? null : safeParseContent(message.content);

    return {
      content,
      toolCalls,
      finishReason: choice.finish_reason,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : null,
      model: completion.model,
    };
  }
}

/** Default client: API key + config from the environment, resolved lazily. */
export function createInvestigatorClient(
  opts: InvestigatorClientOptions = {},
): InvestigatorClient {
  return new InvestigatorClient(opts);
}
