import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  AIProviderError,
  buildConversationContext,
  buildSystemPrompt,
  classifyProviderError,
  deriveConversationTitle,
  isDefaultConversationTitle,
  isGeminiConfigured,
} from "@aurum/ai";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { getConfiguredTextModel } from "@/lib/ai/gemini-client";
import { runAgentWithTools } from "@/lib/agent/agent-runner";
import { buildStreamOutcome } from "@/lib/agent/generation-outcome";
import { createSupabaseToolDataAccess } from "@/lib/tools/data-access";
import { dispatchDeviceTool } from "@/lib/devices/dispatch";
import {
  isDeviceHeartbeatFresh,
  listUserDevices,
} from "@/lib/devices/queries";
import { runSpotifyTool } from "@/lib/integrations/spotify/service";
import { runWebAction } from "@/lib/integrations/web/research";
import {
  getConversationForUser,
  getMessageForUser,
  insertMessage,
  listMessages,
  recordGeneration,
  renameConversation,
  touchConversation,
  type MessageRow,
  type ConversationRow,
} from "./repository";

export type StreamEvent =
  | {
      type: "status";
      state: "thinking" | "acting" | "responding";
      timings?: Record<string, number>;
    }
  | { type: "ready"; timings?: Record<string, number> }
  | { type: "user_message"; message: MessageRow }
  | { type: "assistant_start"; generationId?: string }
  | { type: "delta"; text: string }
  | {
      type: "tool_requested" | "tool_started" | "tool_succeeded" | "tool_failed" | "clarification_needed";
      generationId?: string;
      tool: string;
      executionId?: string;
      data?: unknown;
      error?: { code: string; message: string };
      display?: { label: string; detail?: string };
    }
  | {
      type: "approval_required";
      generationId?: string;
      tool: string;
      executionId?: string;
      approvalId: string;
      display?: { label: string };
    }
  | {
      type: "surface_update";
      generationId?: string;
      surface: "tasks" | "search" | "response" | "file";
      tasks?: Array<{ id: string; title: string; due?: string; status?: string }>;
      notes?: Array<{ id: string; title?: string | null; snippet: string }>;
      files?: Array<{
        id: string;
        name: string;
        relativePath?: string;
        kind?: string;
      }>;
    }
  | {
      type: "done";
      message: MessageRow;
      title?: string;
      generationId?: string;
      usage?: {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        model: string;
        latencyMs: number;
      };
      timings?: Record<string, number>;
      outcome?: {
        actionsCommitted: boolean;
        finalResponseStatus: "completed" | "failed" | "cancelled" | "skipped";
        usedFallbackResponse: boolean;
        allowFullRetry: boolean;
        warning?: string;
      };
    }
  | {
      type: "error";
      error: string;
      code?: string;
      /** When true, tools already succeeded — do not treat as full failure */
      actionsCommitted?: boolean;
      allowFullRetry?: boolean;
    }
  | { type: "title"; title: string }
  | { type: "timing"; name: string; ms: number };

function sseEncode(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export class ChatServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ChatServiceError";
  }
}

function timingLogsEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.AURUM_STREAM_DEBUG === "1"
  );
}

function toUserFacingStreamError(err: unknown): {
  message: string;
  code: string;
} {
  if (err instanceof AIProviderError) {
    return { message: err.toUserMessage(), code: err.code ?? err.kind };
  }
  const classified = classifyProviderError(err, "gemini");
  return {
    message: classified.toUserMessage(),
    code: classified.code ?? classified.kind,
  };
}

/**
 * Returns a ReadableStream immediately (no await of DB/Gemini before return)
 * so the HTTP response can open and flush a thinking status ASAP.
 */
export function createChatStream(options: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  content?: string;
  retryOfUserMessageId?: string;
  generationId?: string;
  clientSentAt?: number;
  deviceType?: string;
  timezone?: string;
  signal?: AbortSignal;
  routeStartedAt?: number;
  authCompletedAt?: number;
}): ReadableStream<Uint8Array> {
  if (!isGeminiConfigured()) {
    throw new ChatServiceError(
      "AI not configured. Add GEMINI_API_KEY to apps/web/.env.local and restart.",
      503,
      "ai_not_configured",
    );
  }

  const rate = checkRateLimit({
    key: `chat:${options.userId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    throw new ChatServiceError(
      "Too many requests. Wait a moment and try again.",
      429,
      "rate_limited",
    );
  }

  if (!options.retryOfUserMessageId) {
    const content = options.content?.trim() ?? "";
    if (!content) {
      throw new ChatServiceError("Message cannot be empty", 400, "empty");
    }
  }

  const encoder = new TextEncoder();
  const logTiming = timingLogsEnabled();
  const t0 = options.routeStartedAt ?? Date.now();
  // Every user turn MUST have a unique generationId — missing ids collapse
  // execution keys to "gen:…" and falsely replay prior ToolResults (e.g. skip).
  const generationId = options.generationId ?? randomUUID();
  const configuredModel = getConfiguredTextModel();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const timings: Record<string, number> = {
        request_received: 0,
      };

      if (options.clientSentAt != null) {
        timings.send_to_api = Math.max(0, t0 - options.clientSentAt);
      }
      if (options.authCompletedAt != null) {
        timings.auth_complete = Math.max(
          0,
          options.authCompletedAt - t0,
        );
      }

      const mark = (name: string) => {
        timings[name] = Date.now() - t0;
      };

      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(sseEncode(event)));
      };

      const logTrace = (extra?: Record<string, unknown>) => {
        if (!logTiming) return;
        console.info("[aurum:latency-trace]", {
          model: configuredModel,
          generationId: generationId ?? null,
          ...timings,
          ...extra,
        });
      };

      // T1/open: flush status immediately — do not wait for Gemini or DB.
      send({
        type: "status",
        state: "thinking",
        timings: { ...timings },
      });
      send({ type: "ready", timings: { ...timings } });
      mark("stream_opened");
      if (logTiming) {
        console.info("[aurum:latency-trace]", {
          event: "stream_opened",
          ms: timings.stream_opened,
          send_to_api: timings.send_to_api ?? null,
          model: configuredModel,
        });
      }

      let fullText = "";
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      let totalTokens: number | null = null;
      let userMessage: MessageRow | null = null;
      let conversation: ConversationRow | null = null;

      try {
        if (timings.auth_complete == null) {
          mark("auth_complete");
        }

        // Parallel: ownership + history (history may omit the new user msg yet)
        const historyLimit = 24;
        const [conversationResult, historyRows] = await Promise.all([
          getConversationForUser(
            options.supabase,
            options.conversationId,
            options.userId,
          ),
          listMessages(
            options.supabase,
            options.conversationId,
            options.userId,
            { limit: historyLimit },
          ),
        ]);
        conversation = conversationResult;
        mark("history_loaded");

        if (!conversation) {
          throw new ChatServiceError("Conversation not found", 404, "not_found");
        }

        if (options.retryOfUserMessageId) {
          const existing = await getMessageForUser(
            options.supabase,
            options.retryOfUserMessageId,
            options.userId,
          );
          if (
            !existing ||
            existing.conversation_id !== options.conversationId ||
            existing.role !== "user"
          ) {
            throw new ChatServiceError(
              "Retry target message not found",
              404,
              "retry_not_found",
            );
          }
          userMessage = existing;
        } else {
          userMessage = await insertMessage(options.supabase, {
            conversationId: options.conversationId,
            userId: options.userId,
            role: "user",
            content: options.content!.trim(),
            metadata: generationId ? { generationId } : {},
          });
          void touchConversation(
            options.supabase,
            options.conversationId,
            options.userId,
          );
        }
        mark("user_message_persisted");
        send({ type: "user_message", message: userMessage });

        const userIndex = historyRows.findIndex((m) => m.id === userMessage!.id);
        const slice =
          userIndex >= 0
            ? historyRows.slice(0, userIndex + 1)
            : [
                ...historyRows.filter((m) => m.id !== userMessage!.id),
                userMessage,
              ];

        const context = buildConversationContext({
          history: slice
            .filter((m) => m.role === "user" || m.role === "assistant")
            .filter((m) => !(m.role === "assistant" && m.status === "error"))
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          limit: historyLimit,
        });

        const timezone = options.timezone ?? "America/Chicago";
        const instructions = buildSystemPrompt({
          deviceType: options.deviceType ?? "WEB",
          timezone,
          now: new Date(),
        });

        send({ type: "assistant_start", generationId });
        mark("gemini_request_started");
        if (logTiming) {
          console.info("[aurum:latency-trace]", {
            event: "gemini_request_started",
            auth_ms: timings.auth_complete,
            history_ms: timings.history_loaded,
            user_persist_ms: timings.user_message_persisted,
            gemini_start_ms: timings.gemini_request_started,
          });
        }

        let firstChunkAt: number | null = null;
        let aborted = Boolean(options.signal?.aborted);
        let modelName = "gemini";

        const agentResult = await runAgentWithTools({
          instructions,
          history: context,
          ctx: {
            userId: options.userId,
            conversationId: options.conversationId,
            generationId,
            timezone,
            now: new Date(),
            signal: options.signal,
            data: createSupabaseToolDataAccess({
              supabase: options.supabase,
              userId: options.userId,
              conversationId: options.conversationId,
              generationId,
            }),
            log: (event) => {
              if (logTiming) console.info("[aurum:tool]", event);
            },
            listDevices: async () => {
              const rows = await listUserDevices(
                options.supabase,
                options.userId,
              );
              return rows
                .filter((d) => d.status !== "disabled")
                .map((d) => ({
                  id: d.id,
                  name: d.name,
                  platform: d.platform ?? d.device_type,
                  status: isDeviceHeartbeatFresh(d.last_seen_at)
                    ? "online"
                    : "offline",
                  last_seen_at: d.last_seen_at,
                  app_version: d.app_version,
                }));
            },
            dispatchDeviceTool: async (tool, input, executionId) => {
              return dispatchDeviceTool({
                supabase: options.supabase,
                userId: options.userId,
                tool,
                input,
                executionId,
                signal: options.signal,
                log: (event) => {
                  if (logTiming) console.info("[aurum:device]", event);
                },
              });
            },
            runSpotifyAction: async (action, input, toolCtx) => {
              const signal = toolCtx?.signal ?? options.signal;
              const dispatch =
                toolCtx?.dispatchDeviceTool ??
                (async (tool, toolInput, executionId) =>
                  dispatchDeviceTool({
                    supabase: options.supabase,
                    userId: options.userId,
                    tool,
                    input: toolInput,
                    executionId,
                    signal,
                    log: (event) => {
                      if (logTiming) console.info("[aurum:device]", event);
                    },
                  }));
              return runSpotifyTool({
                supabase: options.supabase,
                userId: options.userId,
                conversationId: options.conversationId,
                action,
                input,
                signal,
                executionId: toolCtx?.currentExecutionId,
                openSpotifyDesktop: async () => {
                  const executionId = `${
                    toolCtx?.currentExecutionId ??
                    generationId
                  }:open-spotify`;
                  const result = await dispatch(
                    "open_application",
                    { app: "Spotify" },
                    executionId,
                  );
                  return {
                    ok: result.success,
                    message: result.message ?? result.error?.message,
                  };
                },
              });
            },
            runWebAction: async (action, input, toolCtx) => {
              return runWebAction({
                action,
                input,
                signal: toolCtx?.signal ?? options.signal,
              });
            },
          },
          hooks: {
            onStatus: (state) => {
              send({ type: "status", state });
            },
            onDelta: (text) => {
              if (!text) return;
              if (firstChunkAt == null) {
                firstChunkAt = Date.now() - t0;
                timings.first_gemini_chunk = firstChunkAt;
                timings.first_chunk_sent = firstChunkAt;
                if (logTiming) {
                  console.info("[aurum:latency-trace]", {
                    event: "first_gemini_chunk",
                    ms: firstChunkAt,
                    deltaChars: text.length,
                  });
                }
              }
              fullText += text;
              send({ type: "delta", text });
            },
            onToolEvent: (event) => {
              if (event.type === "approval_required") {
                send({
                  type: "approval_required",
                  generationId: event.generationId,
                  tool: event.tool,
                  executionId: event.executionId,
                  approvalId: event.approvalId,
                  display: event.display,
                });
                return;
              }
              send({
                type: event.type,
                generationId: event.generationId,
                tool: event.tool,
                executionId: event.executionId,
                data: "data" in event ? event.data : undefined,
                error: "error" in event ? event.error : undefined,
                display: event.display,
              });
            },
            onSurfaceUpdate: (update) => {
              send({
                type: "surface_update",
                generationId,
                ...update,
              });
            },
          },
        });

        modelName = agentResult.model;
        inputTokens = agentResult.usage.inputTokens;
        outputTokens = agentResult.usage.outputTokens;
        totalTokens = agentResult.usage.totalTokens;
        aborted = Boolean(options.signal?.aborted);
        // Prefer accumulated stream text; fall back to agent-assembled text
        // (deterministic ToolResult fallback may only exist on the return value).
        if (!fullText.trim() && agentResult.fullText.trim()) {
          fullText = agentResult.fullText;
        }

        mark("gemini_completed");
        const latencyMs = Date.now() - t0;
        const trimmed = fullText.trim();
        const model = modelName;
        const actionsCommitted = agentResult.actionsCommitted;
        const streamOutcome = buildStreamOutcome({
          actionsCommitted,
          finalResponseStatus: agentResult.finalResponseStatus,
          usedFallbackResponse: agentResult.usedFallbackResponse,
          cancelled: aborted || Boolean(options.signal?.aborted),
        });
        const allowFullRetry = streamOutcome.allowFullRetry;
        const outcomeWarning = streamOutcome.warning;

        if (aborted || options.signal?.aborted) {
          if (trimmed || actionsCommitted) {
            const content =
              trimmed ||
              "Action completed before cancellation was fully applied.";
            const partial = await insertMessage(options.supabase, {
              conversationId: options.conversationId,
              userId: options.userId,
              role: "assistant",
              content,
              status: "partial",
              metadata: {
                cancelled: true,
                model,
                provider: "gemini",
                actionsCommitted,
                ...(generationId ? { generationId } : {}),
              },
            });
            mark("assistant_persisted");
            void touchConversation(
              options.supabase,
              options.conversationId,
              options.userId,
            );
            void recordGeneration(options.supabase, {
              userId: options.userId,
              conversationId: options.conversationId,
              messageId: partial.id,
              model,
              latencyMs,
              inputTokens,
              outputTokens,
              totalTokens,
              status: "cancelled",
            });
            timings.completed = Date.now() - t0;
            send({
              type: "done",
              message: partial,
              generationId,
              usage: {
                inputTokens,
                outputTokens,
                totalTokens,
                model,
                latencyMs,
              },
              timings,
              outcome: {
                actionsCommitted,
                finalResponseStatus: "cancelled",
                usedFallbackResponse: agentResult.usedFallbackResponse,
                allowFullRetry: false,
              },
            });
          } else {
            send({
              type: "error",
              error: "Generation stopped.",
              code: "cancelled",
              actionsCommitted: false,
              allowFullRetry: false,
            });
          }
          controller.close();
          return;
        }

        if (!trimmed && !actionsCommitted) {
          throw new Error("Model returned an empty response");
        }

        const assistantContent =
          trimmed ||
          "Action completed.";

        const assistantMessage = await insertMessage(options.supabase, {
          conversationId: options.conversationId,
          userId: options.userId,
          role: "assistant",
          content: assistantContent,
          status: "complete",
          metadata: {
            model,
            provider: "gemini",
            toolCount: agentResult.toolResults.length,
            actionsCommitted,
            finalResponseStatus: agentResult.finalResponseStatus,
            usedFallbackResponse: agentResult.usedFallbackResponse,
            ...(generationId ? { generationId } : {}),
          },
        });
        mark("assistant_persisted");

        void touchConversation(
          options.supabase,
          options.conversationId,
          options.userId,
        );

        let newTitle: string | undefined;
        if (isDefaultConversationTitle(conversation.title)) {
          newTitle = deriveConversationTitle(userMessage.content);
          void renameConversation(
            options.supabase,
            options.conversationId,
            options.userId,
            newTitle,
          );
          send({ type: "title", title: newTitle });
        }

        void recordGeneration(options.supabase, {
          userId: options.userId,
          conversationId: options.conversationId,
          messageId: assistantMessage.id,
          model,
          latencyMs,
          inputTokens,
          outputTokens,
          totalTokens,
          status:
            agentResult.finalResponseStatus === "failed" && actionsCommitted
              ? "success"
              : agentResult.finalResponseStatus === "failed"
                ? "error"
                : "success",
        });

        timings.completed = Date.now() - t0;
        if (logTiming) {
          console.info("[aurum:latency-trace]", {
            event: "complete",
            gemini_ttft_ms: timings.first_gemini_chunk ?? null,
            total_ms: timings.completed,
            tools: agentResult.toolResults.length,
            actionsCommitted,
            finalResponseStatus: agentResult.finalResponseStatus,
            usedFallbackResponse: agentResult.usedFallbackResponse,
            model,
          });
        }

        send({
          type: "done",
          message: assistantMessage,
          title: newTitle,
          generationId,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens,
            model,
            latencyMs,
          },
          timings,
          outcome: {
            actionsCommitted,
            finalResponseStatus: agentResult.finalResponseStatus,
            usedFallbackResponse: agentResult.usedFallbackResponse,
            allowFullRetry,
            warning: outcomeWarning,
          },
        });

        if (actionsCommitted) {
          try {
            revalidatePath("/tasks");
            revalidatePath("/today");
          } catch {
            // revalidatePath may throw outside request scope in some runtimes
          }
        }

        controller.close();
        return;
      } catch (err) {
        const model = "gemini";
        if (err instanceof ChatServiceError) {
          send({ type: "error", error: err.message, code: err.code });
          controller.close();
          return;
        }

        const facing = toUserFacingStreamError(err);
        console.error("[aurum] chat stream error:", {
          code: facing.code,
          summary:
            err instanceof AIProviderError
              ? err.message.slice(0, 300)
              : facing.message,
          model,
          ms: Date.now() - t0,
        });

        // Generic full failure — nothing committed in this catch path
        // (tool-committed continuation failures are handled inside the agent)
        if (fullText.trim()) {
          try {
            const partial = await insertMessage(options.supabase, {
              conversationId: options.conversationId,
              userId: options.userId,
              role: "assistant",
              content: fullText.trim(),
              status: "error",
              metadata: {
                model,
                provider: "gemini",
                error: facing.code,
                ...(generationId ? { generationId } : {}),
              },
            });
            send({
              type: "done",
              message: partial,
              generationId,
              timings,
              outcome: {
                actionsCommitted: false,
                finalResponseStatus: "failed",
                usedFallbackResponse: false,
                allowFullRetry: true,
              },
            });
          } catch {
            // ignore persistence failure after error
          }
        }

        send({
          type: "error",
          error: facing.message,
          code: facing.code,
          actionsCommitted: false,
          allowFullRetry: true,
        });

        void recordGeneration(options.supabase, {
          userId: options.userId,
          conversationId: options.conversationId,
          messageId: null,
          model,
          latencyMs: Date.now() - t0,
          inputTokens,
          outputTokens,
          totalTokens,
          status: "error",
          error: facing.code,
        });

        controller.close();
      }
    },
  });
}
