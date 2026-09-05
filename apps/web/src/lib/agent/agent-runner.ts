import type { Content, Part } from "@google/genai";
import { createPartFromFunctionResponse } from "@google/genai";
import {
  MAX_TOOL_CALLS_PER_REQUEST,
  MAX_TOOL_ROUNDS,
  createDefaultRegistry,
  executeToolCall,
  toModelToolResult,
  type ToolExecutionContext,
  type ToolExecutorEvent,
  type ToolRegistry,
  type ToolResult,
} from "@aurum/tools";
import { type ContextMessage } from "@aurum/ai";
import {
  getConfiguredTextModel,
  getGeminiClient,
} from "@/lib/ai/gemini-client";

export type AgentToolEvent = ToolExecutorEvent & {
  generationId?: string;
};

export type AgentSurfaceUpdate = {
  surface: "tasks" | "search" | "response" | "file";
  tasks?: Array<{ id: string; title: string; due?: string; status?: string }>;
  notes?: Array<{ id: string; title?: string | null; snippet: string }>;
  files?: Array<{
    id: string;
    name: string;
    relativePath?: string;
    kind?: string;
  }>;
};

export type AgentRunnerHooks = {
  onToolEvent?: (event: AgentToolEvent) => void;
  onSurfaceUpdate?: (update: AgentSurfaceUpdate) => void;
  onStatus?: (state: "thinking" | "acting" | "responding") => void;
  onDelta?: (text: string) => void;
};

export type UsageSnapshot = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type FinalResponseStatus = "completed" | "failed" | "cancelled" | "skipped";

export type GenerationOutcome = {
  fullText: string;
  toolResults: ToolResult[];
  hitLoopLimit: boolean;
  model: string;
  usage: UsageSnapshot;
  actionsCommitted: boolean;
  finalResponseStatus: FinalResponseStatus;
  finalResponseError?: { code: string; message: string };
  /** True when assistant text came from ToolResult fallback, not Gemini */
  usedFallbackResponse: boolean;
};

function toContents(history: ContextMessage[]): Content[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
}

/** Last-resort dummy so Gemini 3 accepts continuation if stream dropped the real signature. */
export const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

export function partThoughtSignature(part: Part): string | undefined {
  const value = (part as { thoughtSignature?: unknown }).thoughtSignature;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Accumulate streamed model parts without dropping thoughtSignature.
 * Streaming often delivers the signature on a later chunk or orphan part.
 */
export function mergeModelParts(existing: Part[], incoming: Part[]): Part[] {
  const next = [...existing];
  for (const part of incoming) {
    if (part.functionCall) {
      const id = part.functionCall.id;
      const idx = id
        ? next.findIndex((p) => p.functionCall?.id === id)
        : -1;
      if (idx >= 0) {
        const prev = next[idx]!;
        next[idx] = {
          ...prev,
          ...part,
          // Never let a later chunk wipe a signature we already captured
          thoughtSignature:
            partThoughtSignature(part) ?? partThoughtSignature(prev),
        };
      } else {
        next.push(part);
      }
      continue;
    }
    if (typeof part.text === "string" && part.text.length > 0) {
      const last = next[next.length - 1];
      if (last && typeof last.text === "string" && !last.functionCall) {
        next[next.length - 1] = {
          ...last,
          text: last.text + part.text,
          thoughtSignature:
            partThoughtSignature(part) ?? partThoughtSignature(last),
        };
      } else {
        next.push(part);
      }
      continue;
    }
    next.push(part);
  }
  return next;
}

/**
 * Prepare model parts for the next generateContent turn.
 * Gemini 3 requires thoughtSignature on the first functionCall part.
 */
export function finalizeModelPartsForReplay(parts: Part[]): Part[] {
  const orphans: string[] = [];
  const kept: Part[] = [];

  for (const part of parts) {
    const sig = partThoughtSignature(part);
    const hasFc = Boolean(part.functionCall);
    const hasText = typeof part.text === "string" && part.text.length > 0;
    if (!hasFc && !hasText && sig) {
      orphans.push(sig);
      continue;
    }
    kept.push(part);
  }

  let orphanIdx = 0;
  const out = kept.map((part) => {
    if (!part.functionCall || partThoughtSignature(part)) return part;
    if (orphanIdx < orphans.length) {
      return { ...part, thoughtSignature: orphans[orphanIdx++]! };
    }
    return part;
  });

  const firstFc = out.findIndex((p) => p.functionCall);
  if (firstFc >= 0 && !partThoughtSignature(out[firstFc]!)) {
    out[firstFc] = {
      ...out[firstFc]!,
      thoughtSignature: SKIP_THOUGHT_SIGNATURE,
    };
  }

  return out;
}

/**
 * Streaming Gemini ↔ Aurum tool loop.
 *
 * CRITICAL (Gemini 3): model functionCall parts must be replayed with their
 * original `thoughtSignature`. Reconstructing bare functionCall objects
 * causes HTTP 400 BAD REQUEST on the continuation turn.
 */
export async function runAgentWithTools(options: {
  instructions: string;
  history: ContextMessage[];
  ctx: ToolExecutionContext;
  registry?: ToolRegistry;
  hooks?: AgentRunnerHooks;
}): Promise<GenerationOutcome> {
  const registry = options.registry ?? createDefaultRegistry();
  const model = getConfiguredTextModel();
  const client = getGeminiClient();
  const declarations = registry.toGeminiFunctionDeclarations();
  const contents: Content[] = toContents(options.history);

  let toolCalls = 0;
  let hitLoopLimit = false;
  const toolResults: ToolResult[] = [];
  let fullText = "";
  let finalResponseStatus: FinalResponseStatus = "skipped";
  let finalResponseError: GenerationOutcome["finalResponseError"];
  let usedFallbackResponse = false;
  const usage: UsageSnapshot = {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (options.ctx.signal?.aborted) {
      finalResponseStatus = "cancelled";
      break;
    }

    options.hooks?.onStatus?.("thinking");
    const tRound = Date.now();
    let modelParts: Part[] = [];
    let sawFunctionCall = false;
    let roundText = "";
    let startedResponding = false;

    try {
      const stream = await client.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: options.instructions,
          tools: [{ functionDeclarations: declarations }],
          automaticFunctionCalling: { disable: true },
        },
      });

      for await (const chunk of stream) {
        if (options.ctx.signal?.aborted) break;

        const chunkParts = chunk.candidates?.[0]?.content?.parts;
        if (chunkParts?.length) {
          modelParts = mergeModelParts(modelParts, chunkParts);
          if (chunkParts.some((p) => p.functionCall)) {
            sawFunctionCall = true;
          }
        }

        // Prefer parts-derived functionCalls; chunk.functionCalls is a convenience
        const calls = chunk.functionCalls;
        if (calls?.length) sawFunctionCall = true;

        const delta = chunk.text ?? "";
        if (delta && !sawFunctionCall) {
          roundText += delta;
          if (!startedResponding) {
            startedResponding = true;
            options.hooks?.onStatus?.("responding");
          }
          options.hooks?.onDelta?.(delta);
        }

        const meta = chunk.usageMetadata;
        if (meta) {
          usage.inputTokens = meta.promptTokenCount ?? usage.inputTokens;
          usage.outputTokens = meta.candidatesTokenCount ?? usage.outputTokens;
          usage.totalTokens = meta.totalTokenCount ?? usage.totalTokens;
        }
      }
    } catch (err) {
      // Continuation (or first) Gemini call failed
      const code =
        err && typeof err === "object" && "status" in err
          ? String((err as { status?: unknown }).status ?? "error")
          : "error";
      const message =
        err instanceof Error ? err.message.slice(0, 400) : "Gemini request failed";

      options.ctx.log?.({
        event: "gemini_round_failed",
        round,
        code,
        message,
        ms: Date.now() - tRound,
        priorToolSuccesses: toolResults.filter((r) => r.success).length,
      });

      if (toolResults.some((r) => r.success)) {
        // Committed actions survive — emit fallback text from ToolResults
        finalResponseStatus = "failed";
        finalResponseError = { code, message };
        const fallback = buildFallbackFromToolResults(toolResults);
        if (fallback && !fullText) {
          usedFallbackResponse = true;
          options.hooks?.onStatus?.("responding");
          options.hooks?.onDelta?.(fallback);
          fullText = fallback;
        }
        break;
      }
      throw err;
    }

    options.ctx.log?.({
      event: "gemini_agent_round",
      round,
      ms: Date.now() - tRound,
      functionCalls: modelParts.filter((p) => p.functionCall).length,
      textChars: roundText.length,
      hasThoughtSignature: modelParts.some((p) =>
        Boolean(partThoughtSignature(p)),
      ),
    });

    const functionParts = modelParts.filter((p) => p.functionCall);
    if (functionParts.length === 0) {
      fullText = roundText || fullText;
      if (roundText && !startedResponding) {
        options.hooks?.onStatus?.("responding");
        options.hooks?.onDelta?.(roundText);
      }
      finalResponseStatus = options.ctx.signal?.aborted
        ? "cancelled"
        : fullText.trim()
          ? "completed"
          : "failed";
      break;
    }

    // Replay FULL model content with thoughtSignature required by Gemini 3
    const replayParts = finalizeModelPartsForReplay(modelParts);
    contents.push({
      role: "model",
      parts: replayParts.filter(
        (p) =>
          p.functionCall ||
          (typeof p.text === "string" && p.text.length > 0) ||
          Boolean(partThoughtSignature(p)),
      ),
    });

    options.hooks?.onStatus?.("acting");
    const responseParts: Part[] = [];

    for (const part of replayParts.filter((p) => p.functionCall)) {
      const call = part.functionCall!;
      if (toolCalls >= MAX_TOOL_CALLS_PER_REQUEST) {
        hitLoopLimit = true;
        responseParts.push(
          createPartFromFunctionResponse(
            call.id ?? `limit-${toolCalls}`,
            call.name ?? "unknown",
            {
              success: false,
              error: {
                code: "LOOP_LIMIT_REACHED",
                message: "Tool call limit reached for this request.",
              },
            },
          ),
        );
        continue;
      }

      toolCalls += 1;
      const toolName = call.name ?? "unknown";
      const executionId = buildExecutionId({
        generationId: options.ctx.generationId,
        toolCallId: call.id,
        toolName,
        round,
        index: toolCalls,
      });

      const result = await executeToolCall({
        registry,
        toolName,
        rawArgs: (call.args ?? {}) as Record<string, unknown>,
        executionId,
        ctx: options.ctx,
        hooks: {
          onEvent: (event) => {
            options.hooks?.onToolEvent?.({
              ...event,
              generationId: options.ctx.generationId,
            });
          },
        },
      });
      toolResults.push(result);
      maybeEmitSurface(result, options.hooks);

      responseParts.push(
        createPartFromFunctionResponse(
          call.id ?? executionId,
          toolName,
          toModelToolResult(result),
        ),
      );
    }

    contents.push({ role: "user", parts: responseParts });

    if (hitLoopLimit || options.ctx.signal?.aborted) {
      if (options.ctx.signal?.aborted) finalResponseStatus = "cancelled";
      break;
    }
  }

  if (hitLoopLimit && !fullText) {
    const msg =
      "I hit the tool-call safety limit before finishing. Please try a simpler request.";
    options.hooks?.onDelta?.(msg);
    fullText = msg;
    usedFallbackResponse = true;
    finalResponseStatus = "failed";
  }

  if (finalResponseStatus === "skipped") {
    finalResponseStatus = fullText.trim() ? "completed" : "failed";
  }

  // If tools succeeded but Gemini produced no final text, use deterministic fallback
  if (
    !fullText.trim() &&
    toolResults.some((r) => r.success) &&
    finalResponseStatus !== "cancelled"
  ) {
    const fallback = buildFallbackFromToolResults(toolResults);
    if (fallback) {
      usedFallbackResponse = true;
      options.hooks?.onStatus?.("responding");
      options.hooks?.onDelta?.(fallback);
      fullText = fallback;
      if (finalResponseStatus === "failed") {
        // keep failed status for AI continuation, but we have usable text
      } else {
        finalResponseStatus = "completed";
      }
    }
  }

  return {
    fullText,
    toolResults,
    hitLoopLimit,
    model,
    usage,
    actionsCommitted: toolResults.some((r) => r.success),
    finalResponseStatus,
    finalResponseError,
    usedFallbackResponse,
  };
}

export function buildFallbackFromToolResults(results: ToolResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    if (r.success) {
      lines.push(r.message ?? r.activityLabel ?? "Done.");
    } else if (r.error?.code === "AMBIGUOUS_MATCH") {
      lines.push(r.error.message);
    } else if (r.error) {
      lines.push(r.error.message);
    }
  }
  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0]!;
  return lines.join(" ");
}

function buildExecutionId(parts: {
  generationId?: string;
  toolCallId?: string;
  toolName: string;
  round: number;
  index: number;
}): string {
  if (parts.toolCallId) {
    return `${parts.generationId ?? "gen"}:${parts.toolCallId}`;
  }
  return `${parts.generationId ?? "gen"}:${parts.toolName}:r${parts.round}:i${parts.index}`;
}

function maybeEmitSurface(
  result: ToolResult,
  hooks?: AgentRunnerHooks,
): void {
  if (!result.success || !result.data || !hooks?.onSurfaceUpdate) return;
  const surface = result.metadata?.surface;
  const data = result.data as {
    task?: {
      id: string;
      title: string;
      due_label?: string | null;
      status?: string;
    };
    tasks?: Array<{
      id: string;
      title: string;
      due_label?: string | null;
      status?: string;
    }>;
    note?: { id: string; title?: string | null; content: string };
    notes?: Array<{ id: string; title?: string | null; content: string }>;
    files?: Array<{
      name: string;
      relativePath?: string;
      path?: string;
      rootLabel?: string;
    }>;
  };

  if (surface === "tasks") {
    const tasks = data.tasks
      ? data.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          due: t.due_label ?? undefined,
          status: t.status,
        }))
      : data.task
        ? [
            {
              id: data.task.id,
              title: data.task.title,
              due: data.task.due_label ?? undefined,
              status: data.task.status,
            },
          ]
        : [];
    hooks.onSurfaceUpdate({ surface: "tasks", tasks });
  }

  if (surface === "search") {
    if (data.notes) {
      hooks.onSurfaceUpdate({
        surface: "search",
        notes: data.notes.map((n) => ({
          id: n.id,
          title: n.title,
          snippet: n.content.slice(0, 160),
        })),
      });
    } else if (data.note) {
      hooks.onSurfaceUpdate({
        surface: "search",
        notes: [
          {
            id: data.note.id,
            title: data.note.title,
            snippet: data.note.content.slice(0, 160),
          },
        ],
      });
    }
  }

  if ((surface === "file" || data.files) && data.files) {
    hooks.onSurfaceUpdate({
      surface: "file",
      files: data.files.map((f, i) => ({
        id: f.path ?? `${f.name}-${i}`,
        name: f.name,
        relativePath: f.relativePath
          ? `${f.rootLabel ? `${f.rootLabel} / ` : ""}${f.relativePath}`
          : f.rootLabel,
      })),
    });
  }
}
