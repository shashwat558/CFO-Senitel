// Agent-compatible tool adapter — exposes the deterministic registered tools
// to OpenAI tool calling WITHOUT rewriting the underlying financial tools.
//
// Flow: OpenAI tool definition -> Zod input validation (existing schemas)
//   -> existing tool execute -> normalized structured output envelope.
//
// Every call (success, validation failure, unknown tool, execution failure)
// is audit-logged via `auditToolCall`, so the agent trail is complete.

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { executeTool, TOOL_NAMES, TOOL_REGISTRY } from "./registry";
import { auditToolCall, ToolError, type ToolContext } from "./types";

// ---------------------------------------------------------------------------
// Minimal Zod -> JSON Schema converter.
//
// Covers exactly the Zod surface used by the tool input schemas:
// objects, strings (incl. datetime/format), numbers (int/min/max),
// booleans, enums, arrays, optionals/defaults, refinements (ZodEffects),
// nullable. Anything else degrades to {} rather than throwing, so schema
// generation can never break tool execution.
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case "ZodEffects": {
      const inner = (def.schema ?? def.innerType) as z.ZodTypeAny;
      return zodToJsonSchema(inner);
    }
    case "ZodOptional":
    case "ZodDefault": {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return inner;
    }
    case "ZodNullable": {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return { ...inner, nullable: true };
    }
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(field);
        if (!isOptionalField(field)) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodString": {
      const checks = (def.checks ?? []) as Array<{ kind: string }>;
      const out: JsonSchema = { type: "string" };
      if (checks.some((c) => c.kind === "datetime")) out.format = "date-time";
      const min = (def.checks ?? []) as Array<{ kind: string; value?: number }>;
      const minLength = min.find((c) => c.kind === "min");
      if (minLength?.value !== undefined) out.minLength = minLength.value;
      return out;
    }
    case "ZodNumber": {
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: number }>;
      const out: JsonSchema = { type: checks.some((c) => c.kind === "int") ? "integer" : "number" };
      const min = checks.find((c) => c.kind === "min");
      const max = checks.find((c) => c.kind === "max");
      if (min?.value !== undefined) out.minimum = min.value;
      if (max?.value !== undefined) out.maximum = max.value;
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: [...(def.values as string[])] };
    case "ZodNativeEnum":
      return { type: "string", enum: Object.values(def.values as Record<string, string>) };
    case "ZodLiteral":
      return { enum: [def.value] };
    case "ZodArray":
      return { type: "array", items: zodToJsonSchema(def.type as z.ZodTypeAny) };
    default:
      return {};
  }
}

function isOptionalField(schema: z.ZodTypeAny): boolean {
  let current: unknown = schema;
  while (current instanceof z.ZodEffects) {
    current = (current as unknown as { _def: { schema: unknown } })._def.schema;
  }
  return (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    (current as { isOptional?: () => boolean }).isOptional?.() === true
  );
}

// ---------------------------------------------------------------------------
// OpenAI tool definitions (LLM-compatible schemas for every registered tool).
// ---------------------------------------------------------------------------

export function toOpenAITool(name: string): ChatCompletionTool {
  const tool = TOOL_REGISTRY[name] as { description: string; inputSchema: z.ZodTypeAny } | undefined;
  if (!tool) throw new ToolError("UNKNOWN_TOOL", `unknown tool: ${name}`);
  return {
    type: "function",
    function: {
      name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema) as ChatCompletionTool["function"]["parameters"],
    },
  };
}

/** OpenAI `tools` array covering every registered tool. */
export function getOpenAITools(): ChatCompletionTool[] {
  return TOOL_NAMES.map(toOpenAITool);
}

// ---------------------------------------------------------------------------
// Structured results + audited execution.
// ---------------------------------------------------------------------------

export type AgentToolSuccess = { ok: true; tool: string; data: unknown };
export type AgentToolFailure = { ok: false; tool: string; code: string; message: string };
export type AgentToolResult = AgentToolSuccess | AgentToolFailure;

/**
 * Execute a tool call coming from the LLM.
 *
 * Accepts the raw `arguments` string (or a pre-parsed object), validates it
 * against the tool's existing Zod schema, runs the existing tool, and
 * returns a normalized envelope. Audit-logs every outcome — including
 * validation failures and unknown tools — so the agent trail is complete.
 */
export async function executeAgentTool(
  name: string,
  rawArgs: string | unknown,
  ctx: ToolContext,
): Promise<AgentToolResult> {
  let args: unknown = rawArgs;
  if (typeof rawArgs === "string") {
    try {
      args = rawArgs.trim() === "" ? {} : JSON.parse(rawArgs);
    } catch {
      await auditToolCall(ctx, name, { rawArgs }, false, { code: "BAD_JSON" });
      return { ok: false, tool: name, code: "BAD_JSON", message: `invalid JSON arguments for ${name}` };
    }
  }
  try {
    const data = await executeTool(name, args, ctx);
    await auditToolCall(ctx, name, args, true, { via: "agent" });
    return { ok: true, tool: name, data: sanitizeForLlm(data) };
  } catch (err) {
    const code = err instanceof ToolError ? err.code : "EXECUTION_FAILED";
    const message = err instanceof Error ? err.message : String(err);
    await auditToolCall(ctx, name, args, false, { code, via: "agent" });
    return { ok: false, tool: name, code, message };
  }
}

/** Ensure the payload is JSON-serializable before handing it to the LLM. */
function sanitizeForLlm(data: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return { unserializable: true };
  }
}
