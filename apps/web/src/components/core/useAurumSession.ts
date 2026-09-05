"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UiConversation, UiMessage } from "@/components/assistant/types";
import {
  activityTargetFromToolResult,
  conversationHref,
  dedupeRecents,
  inferContextualSurface,
  isUuid,
  noteHref,
  relativeTimeLabel,
  taskHref,
  type ContextualSurfaceKind,
  type EntityType,
} from "@aurum/shared";
import {
  applyConversationListFetch,
  createGenerationAbortController,
} from "@/lib/conversations/list-state";
import {
  resolveClientDoneOutcome,
  resolveClientStreamError,
} from "@/lib/agent/generation-outcome";
import {
  notifyNotesChanged,
  notifyTasksChanged,
} from "@/lib/tasks/list-state";

export type WorkspaceMode = "home" | "session";

export type SessionActivity = {
  id: string;
  label: string;
  detail?: string;
  state: "pending" | "success" | "error";
  createdAt: string;
  entityType?: EntityType;
  entityId?: string;
  /** Aurum-built href only */
  href?: string;
};

export type SurfaceTask = {
  id: string;
  title: string;
  due?: string;
  status?: string;
  href?: string;
};

export type SurfaceNote = {
  id: string;
  title?: string | null;
  snippet: string;
  href?: string;
};

export type SurfaceFile = {
  id: string;
  name: string;
  relativePath?: string;
  kind?: string;
};

type StreamOutcomePayload = {
  actionsCommitted: boolean;
  finalResponseStatus: "completed" | "failed" | "cancelled" | "skipped";
  usedFallbackResponse: boolean;
  allowFullRetry: boolean;
  warning?: string;
};

type StreamEvent =
  | { type: "status"; state: "thinking" | "acting" | "responding" }
  | { type: "user_message"; message: UiMessage }
  | { type: "assistant_start"; generationId?: string }
  | { type: "delta"; text: string }
  | {
      type: "tool_requested" | "tool_started" | "tool_succeeded" | "tool_failed";
      tool: string;
      executionId?: string;
      data?: unknown;
      error?: { code: string; message: string };
      display?: { label: string; detail?: string };
    }
  | {
      type: "approval_required";
      tool: string;
      approvalId: string;
      display?: { label: string };
    }
  | {
      type: "surface_update";
      surface: "tasks" | "search" | "response" | "file";
      tasks?: SurfaceTask[];
      notes?: SurfaceNote[];
      files?: SurfaceFile[];
    }
  | {
      type: "done";
      message: UiMessage;
      title?: string;
      outcome?: StreamOutcomePayload;
    }
  | {
      type: "error";
      error: string;
      code?: string;
      actionsCommitted?: boolean;
      allowFullRetry?: boolean;
    }
  | { type: "title"; title: string };

export function useAurumSession() {
  const [conversations, setConversations] = useState<UiConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessionMessages, setSessionMessages] = useState<UiMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseWarning, setResponseWarning] = useState<string | null>(null);
  const [allowFullRetry, setAllowFullRetry] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UiConversation | null>(null);
  const [pendingRetryUserId, setPendingRetryUserId] = useState<string | null>(
    null,
  );
  const [workspace, setWorkspace] = useState<WorkspaceMode>("home");
  const [showTranscript, setShowTranscript] = useState(false);
  const [activity, setActivity] = useState<SessionActivity[]>([]);
  const [activeSurface, setActiveSurface] =
    useState<ContextualSurfaceKind>("response");
  const [surfaceTasks, setSurfaceTasks] = useState<SurfaceTask[]>([]);
  const [surfaceNotes, setSurfaceNotes] = useState<SurfaceNote[]>([]);
  const [surfaceFiles, setSurfaceFiles] = useState<SurfaceFile[]>([]);
  const [acting, setActing] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(
    null,
  );
  const [pendingApprovalLabel, setPendingApprovalLabel] = useState<
    string | null
  >(null);
  const [command, setCommand] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const activityIdRef = useRef(0);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error("Failed to load conversations");
      const data = (await res.json()) as { conversations: UiConversation[] };
      const merged = applyConversationListFetch({
        previous: [],
        result: { ok: true, conversations: data.conversations },
      });
      setConversations(merged.conversations);
      setHistoryError(null);
      return merged.conversations;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load history";
      setHistoryError(message);
      setConversations((prev) =>
        applyConversationListFetch({
          previous: prev,
          result: { ok: false, error: message },
        }).conversations,
      );
      return [] as UiConversation[];
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    setMessagesError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      if (!res.ok) throw new Error("Failed to load messages");
      const data = (await res.json()) as { messages: UiMessage[] };
      setMessages(data.messages);
      return data.messages;
    } catch (err) {
      setMessagesError(
        err instanceof Error ? err.message : "Failed to load messages",
      );
      return null;
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await loadConversations();
      setSelectedId((current) => current ?? list[0]?.id ?? null);
    })();
  }, [loadConversations]);

  async function handleNewSession() {
    setError(null);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      setError("Could not start a new session");
      return;
    }
    const data = (await res.json()) as { conversation: UiConversation };
    setConversations((prev) => [data.conversation, ...prev]);
    setSelectedId(data.conversation.id);
    setMessages([]);
    setSessionMessages([]);
    setWorkspace("home");
    setShowTranscript(false);
    setHistoryOpen(false);
    setActiveSurface("response");
  }

  async function handleSelect(id: string) {
    if (streaming) return;
    setSelectedId(id);
    setHistoryOpen(false);
    setShowTranscript(true);
    setWorkspace("session");
    setSurfaceTasks([]);
    setSurfaceNotes([]);
    setActiveSurface("response");
    const loaded = await loadMessages(id);
    if (loaded) {
      setSessionMessages(loaded);
      const lastUser = [...loaded].reverse().find((m) => m.role === "user");
      if (lastUser) setActiveSurface(inferContextualSurface(lastUser.content));
    }
  }

  async function handleRename(id: string, title: string) {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setError("Could not rename");
      return;
    }
    const data = (await res.json()) as { conversation: UiConversation };
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? data.conversation : c)),
    );
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete");
      return;
    }
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (selectedId === id) {
      const next = remaining[0] ?? null;
      setSelectedId(next?.id ?? null);
      setMessages([]);
      setSessionMessages([]);
      setWorkspace("home");
      setShowTranscript(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setActing(false);
    setAwaitingApproval(false);
  }

  function pushActivity(
    item: Omit<SessionActivity, "id" | "createdAt">,
  ) {
    activityIdRef.current += 1;
    const entry: SessionActivity = {
      ...item,
      id: `act-${activityIdRef.current}`,
      createdAt: new Date().toISOString(),
    };
    setActivity((prev) => [entry, ...prev].slice(0, 12));
    return entry.id;
  }

  function patchActivity(
    id: string,
    patch: Partial<
      Pick<
        SessionActivity,
        "label" | "detail" | "state" | "entityType" | "entityId" | "href"
      >
    >,
  ) {
    setActivity((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function runGeneration(opts: {
    conversationId: string;
    content?: string;
    retryOfUserMessageId?: string;
    activityId: string;
  }) {
    setStreaming(true);
    setActing(false);
    setAwaitingApproval(false);
    setError(null);
    setResponseWarning(null);
    setAllowFullRetry(false);
    setPendingRetryUserId(null);

    const controller = createGenerationAbortController();
    abortRef.current = controller;
    const generationId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `gen-${Date.now()}`;

    let streamingAssistantId: string | null = null;
    const toolActivityIds = new Map<string, string>();
    let sawToolSucceeded = false;

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: opts.conversationId,
          content: opts.content,
          retryOfUserMessageId: opts.retryOfUserMessageId,
          generationId,
          clientSentAt: Date.now(),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(json) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "status") {
            if (event.state === "acting") {
              // Only enter ACTING when a tool is actually in-flight
              if (toolActivityIds.size > 0) setActing(true);
            }
            if (event.state === "thinking" || event.state === "responding") {
              if (toolActivityIds.size === 0) setActing(false);
            }
            continue;
          }

          if (
            event.type === "tool_requested" ||
            event.type === "tool_started"
          ) {
            const key = event.executionId ?? event.tool;
            setActing(true);
            const label = (event.display?.label ?? event.tool).toUpperCase();
            const existingId = toolActivityIds.get(key);
            if (existingId) {
              // Same execution — update caption, do not create orphan pending rows
              patchActivity(existingId, {
                label,
                detail: event.display?.detail,
                state: "pending",
              });
            } else {
              const id = pushActivity({
                label,
                detail: event.display?.detail,
                state: "pending",
              });
              toolActivityIds.set(key, id);
            }
            continue;
          }

          if (event.type === "tool_succeeded") {
            sawToolSucceeded = true;
            const key = event.executionId ?? event.tool;
            const id = toolActivityIds.get(key);
            toolActivityIds.delete(key);
            setActing(toolActivityIds.size > 0);
            const target = activityTargetFromToolResult({
              tool: event.tool,
              data: event.data,
            });
            const patch = {
              state: "success" as const,
              label: (event.display?.label ?? event.tool).toUpperCase(),
              detail: event.display?.detail,
              ...(target
                ? {
                    entityType: target.entityType,
                    entityId: target.entityId,
                    href: target.href,
                  }
                : {}),
            };
            if (id) {
              patchActivity(id, patch);
            } else {
              pushActivity(patch);
            }

            if (
              event.tool.includes("task") ||
              target?.entityType === "task"
            ) {
              notifyTasksChanged();
            }
            if (
              event.tool.includes("note") ||
              target?.entityType === "note"
            ) {
              notifyNotesChanged();
            }
            continue;
          }

          if (event.type === "tool_failed") {
            const key = event.executionId ?? event.tool;
            const id = toolActivityIds.get(key);
            toolActivityIds.delete(key);
            setActing(toolActivityIds.size > 0);
            const detail =
              event.display?.detail ?? event.error?.message ?? "Failed";
            if (id) {
              patchActivity(id, {
                state: "error",
                label: "FAILED",
                detail,
              });
            } else {
              pushActivity({
                label: "FAILED",
                detail,
                state: "error",
              });
            }
            continue;
          }

          if (event.type === "approval_required") {
            setAwaitingApproval(true);
            setActing(false);
            setPendingApprovalId(event.approvalId);
            setPendingApprovalLabel(event.display?.label ?? event.tool);
            pushActivity({
              label: "APPROVAL REQUIRED",
              detail: event.display?.label ?? event.tool,
              state: "pending",
            });
            setActiveSurface("approval");
            continue;
          }

          if (event.type === "surface_update") {
            if (event.surface === "tasks" && event.tasks) {
              setSurfaceTasks(
                event.tasks.map((t) => ({
                  ...t,
                  href: taskHref(t.id) ?? undefined,
                })),
              );
              setActiveSurface("task");
              notifyTasksChanged();
            }
            if (event.surface === "search" && event.notes) {
              setSurfaceNotes(
                event.notes.map((n) => ({
                  ...n,
                  href: noteHref(n.id) ?? undefined,
                })),
              );
              setActiveSurface("search");
              notifyNotesChanged();
            }
            if (event.surface === "file" && event.files) {
              setSurfaceFiles(event.files);
              setActiveSurface("file");
            }
            continue;
          }

          if (event.type === "user_message") {
            const msg = event.message;
            setMessages((prev) => {
              const filtered = prev.filter(
                (m) =>
                  !(
                    m.id.startsWith("temp-") &&
                    m.content === msg.content
                  ),
              );
              if (filtered.some((m) => m.id === msg.id)) return filtered;
              return [...filtered, msg];
            });
            setSessionMessages((prev) => {
              const filtered = prev.filter(
                (m) =>
                  !(
                    m.id.startsWith("temp-") &&
                    m.content === msg.content
                  ),
              );
              if (filtered.some((m) => m.id === msg.id)) return filtered;
              return [...filtered, msg];
            });
          }

          if (event.type === "assistant_start") {
            streamingAssistantId = `stream-${Date.now()}`;
            const draft: UiMessage = {
              id: streamingAssistantId,
              conversation_id: opts.conversationId,
              user_id: "",
              role: "assistant",
              content: "",
              status: "complete",
              metadata: {},
              created_at: new Date().toISOString(),
              streaming: true,
            };
            setMessages((prev) => [...prev, draft]);
            setSessionMessages((prev) => [...prev, draft]);
          }

          if (event.type === "delta") {
            const id = streamingAssistantId;
            if (!id) continue;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id
                  ? { ...m, content: m.content + event.text, streaming: true }
                  : m,
              ),
            );
            setSessionMessages((prev) =>
              prev.map((m) =>
                m.id === id
                  ? { ...m, content: m.content + event.text, streaming: true }
                  : m,
              ),
            );
          }

          if (event.type === "title") {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === opts.conversationId
                  ? {
                      ...c,
                      title: event.title,
                      updated_at: new Date().toISOString(),
                    }
                  : c,
              ),
            );
          }

          if (event.type === "done") {
            const finalMsg = event.message;
            const replace = (prev: UiMessage[]) => {
              const withoutStream = streamingAssistantId
                ? prev.filter((m) => m.id !== streamingAssistantId)
                : prev;
              if (withoutStream.some((m) => m.id === finalMsg.id)) {
                return withoutStream;
              }
              return [...withoutStream, finalMsg];
            };
            setMessages(replace);
            setSessionMessages(replace);
            streamingAssistantId = null;
            setConversations((prev) => {
              const updated = prev.map((c) =>
                c.id === opts.conversationId
                  ? {
                      ...c,
                      title: event.title ?? c.title,
                      updated_at: new Date().toISOString(),
                    }
                  : c,
              );
              return [...updated].sort(
                (a, b) =>
                  new Date(b.updated_at).getTime() -
                  new Date(a.updated_at).getTime(),
              );
            });

            const resolved = resolveClientDoneOutcome(event.outcome);
            setError(resolved.errorMessage);
            setResponseWarning(resolved.responseWarning);
            setAllowFullRetry(resolved.allowFullRetry);
            setPendingRetryUserId(null);

            patchActivity(opts.activityId, {
              state: "success",
              label: "DONE",
              detail: resolved.responseWarning ?? undefined,
            });
          }

          if (event.type === "error") {
            const handling = resolveClientStreamError({
              errorMessage: event.error,
              actionsCommitted: event.actionsCommitted,
              allowFullRetry: event.allowFullRetry,
              sawToolSucceeded,
            });

            setAllowFullRetry(handling.allowFullRetry);
            setError(handling.errorMessage);
            setResponseWarning(handling.responseWarning);

            if (handling.preserveCommittedActions) {
              // Keep tool ActionStatus / surfaces; do not mark command FAILED
              patchActivity(opts.activityId, {
                state: "success",
                label: "DONE",
                detail: handling.responseWarning ?? undefined,
              });
              setPendingRetryUserId(null);
              continue;
            }

            patchActivity(opts.activityId, {
              state: "error",
              label: "FAILED",
              detail: event.error,
            });
            if (streamingAssistantId) {
              const failId = streamingAssistantId;
              const fail = (prev: UiMessage[]) =>
                prev.map((m) =>
                  m.id === failId
                    ? {
                        ...m,
                        streaming: false,
                        status: "error" as const,
                        metadata: { ...m.metadata, failed: true },
                        content:
                          m.content || event.error || "Generation failed.",
                      }
                    : m,
                );
              setMessages(fail);
              setSessionMessages((prev) => {
                const next = fail(prev);
                if (handling.allowFullRetry) {
                  const lastUser = [...next]
                    .reverse()
                    .find((m) => m.role === "user");
                  if (lastUser) setPendingRetryUserId(lastUser.id);
                }
                return next;
              });
            }
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        if (selectedIdRef.current) {
          await loadMessages(selectedIdRef.current);
        }
        patchActivity(opts.activityId, {
          state: sawToolSucceeded ? "success" : "success",
          label: sawToolSucceeded ? "DONE" : "STOPPED",
          detail: sawToolSucceeded
            ? "Action completed before stop."
            : undefined,
        });
        if (sawToolSucceeded) {
          setAllowFullRetry(false);
          setError(null);
        }
      } else {
        const message =
          err instanceof Error ? err.message : "Generation failed";
        const handling = resolveClientStreamError({
          errorMessage: message,
          sawToolSucceeded,
        });
        setAllowFullRetry(handling.allowFullRetry);
        setError(handling.errorMessage);
        setResponseWarning(handling.responseWarning);

        if (handling.preserveCommittedActions) {
          patchActivity(opts.activityId, {
            state: "success",
            label: "DONE",
            detail: handling.responseWarning ?? undefined,
          });
          setPendingRetryUserId(null);
        } else {
          patchActivity(opts.activityId, {
            state: "error",
            label: "FAILED",
            detail: message,
          });
          const fail = (prev: UiMessage[]) => {
            const lastUser = [...prev].reverse().find((m) => m.role === "user");
            if (lastUser && handling.allowFullRetry) {
              setPendingRetryUserId(lastUser.id);
            }
            return prev.map((m) =>
              m.streaming
                ? {
                    ...m,
                    streaming: false,
                    status: "error" as const,
                    metadata: { ...m.metadata, failed: true },
                    content: m.content || message,
                  }
                : m,
            );
          };
          setMessages(fail);
          setSessionMessages(fail);
        }
      }
    } finally {
      setStreaming(false);
      setActing(false);
      abortRef.current = null;
    }
  }

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setCommand("");
    const continueSession = workspace === "session" && !showTranscript;
    setWorkspace("session");
    setShowTranscript(false);
    setActiveSurface(inferContextualSurface(trimmed));

    const activityId = pushActivity({
      label: "RESPONDING",
      detail: trimmed,
      state: "success",
    });

    let conversationId = selectedId;
    let created = false;
    if (!conversationId) {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError("Could not create session");
        patchActivity(activityId, {
          state: "error",
          label: "FAILED",
          detail: "Could not create session",
        });
        return;
      }
      const data = (await res.json()) as { conversation: UiConversation };
      conversationId = data.conversation.id;
      setConversations((prev) => [data.conversation, ...prev]);
      setSelectedId(conversationId);
      setMessages([]);
      created = true;
    }

    const tempId = `temp-${Date.now()}`;
    const temp: UiMessage = {
      id: tempId,
      conversation_id: conversationId,
      user_id: "",
      role: "user",
      content: trimmed,
      status: "complete",
      metadata: {},
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    setSessionMessages((prev) =>
      created || !continueSession ? [temp] : [...prev, temp],
    );

    await runGeneration({ conversationId, content: trimmed, activityId });

    setSessionMessages((prev) => {
      const hasTemp = prev.some((m) => m.id === tempId);
      if (!hasTemp) return prev;
      const real = prev.find(
        (m) =>
          m.role === "user" &&
          m.content === trimmed &&
          !m.id.startsWith("temp-"),
      );
      if (real) return prev.filter((m) => m.id !== tempId);
      return prev;
    });
    setMessages((prev) => {
      const hasTemp = prev.some((m) => m.id === tempId);
      if (!hasTemp) return prev;
      const real = prev.find(
        (m) =>
          m.role === "user" &&
          m.content === trimmed &&
          !m.id.startsWith("temp-"),
      );
      if (real) return prev.filter((m) => m.id !== tempId);
      return prev;
    });
  }

  async function handleRetry() {
    if (!allowFullRetry) return;
    if (!selectedId) return;
    const lastUser =
      (pendingRetryUserId
        ? sessionMessages.find((m) => m.id === pendingRetryUserId)
        : null) ??
      [...sessionMessages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    const userId = lastUser.id;
    setSessionMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === userId);
      return idx >= 0 ? prev.slice(0, idx + 1) : prev;
    });
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === userId);
      return idx >= 0 ? prev.slice(0, idx + 1) : prev;
    });

    const activityId = pushActivity({
      label: "RETRYING",
      detail: lastUser.content,
      state: "pending",
    });

    await runGeneration({
      conversationId: selectedId,
      retryOfUserMessageId: userId.startsWith("temp-") ? undefined : userId,
      content: userId.startsWith("temp-") ? lastUser.content : undefined,
      activityId,
    });
  }

  async function openNoteById(noteId: string) {
    if (!isUuid(noteId)) return;
    try {
      const res = await fetch(`/api/notes/${noteId}`);
      if (!res.ok) {
        setError("Note unavailable");
        return;
      }
      const data = (await res.json()) as {
        note: {
          id: string;
          title: string | null;
          content: string;
        };
      };
      setSurfaceNotes([
        {
          id: data.note.id,
          title: data.note.title,
          snippet: data.note.content.slice(0, 500),
          href: noteHref(data.note.id) ?? undefined,
        },
      ]);
      setActiveSurface("search");
      setWorkspace("session");
      setShowTranscript(false);
      setError(null);
    } catch {
      setError("Note unavailable");
    }
  }

  async function applyCoreDeepLink(opts: {
    conversationId?: string | null;
    noteId?: string | null;
    query?: string | null;
  }) {
    if (opts.conversationId && isUuid(opts.conversationId)) {
      await handleSelect(opts.conversationId);
    }
    if (opts.noteId && isUuid(opts.noteId)) {
      await openNoteById(opts.noteId);
    }
    const q = opts.query?.trim();
    if (q) {
      // Desktop overlay / deep-link command — same agent path as Core composer
      await handleSend(q);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (url.searchParams.has("q")) {
          url.searchParams.delete("q");
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        }
      }
    }
  }

  function returnHome() {
    if (streaming) handleStop();
    setWorkspace("home");
    setShowTranscript(false);
    setCommand("");
  }

  const visibleMessages = showTranscript ? messages : sessionMessages;
  const lastUser = [...visibleMessages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...visibleMessages]
    .reverse()
    .find((m) => m.role === "assistant");

  /** Recents: objects, not an activity log. Presentation-level dedupe. */
  const recents = dedupeRecents(
    [
      ...activity.map((a) => ({
        ...a,
        meta:
          a.entityType === "task" || a.entityType === "note"
            ? undefined
            : relativeTimeLabel(a.createdAt),
      })),
      ...conversations.slice(0, 8).map((c) => ({
        entityType: "conversation" as const,
        entityId: c.id,
        href: conversationHref(c.id) ?? undefined,
        detail: c.title || "Untitled session",
        label: "Session",
        state: "success",
        createdAt: c.updated_at,
        kindLabel: "Session",
        meta: relativeTimeLabel(c.updated_at),
      })),
    ],
    5,
  );

  return {
    conversations,
    selectedId,
    messages: visibleMessages,
    allMessages: messages,
    loadingList,
    loadingMessages,
    streaming,
    acting,
    awaitingApproval,
    pendingApprovalId,
    pendingApprovalLabel,
    clearPendingApproval: () => {
      setAwaitingApproval(false);
      setPendingApprovalId(null);
      setPendingApprovalLabel(null);
      setActiveSurface("response");
    },
    error,
    responseWarning,
    allowFullRetry,
    historyError,
    messagesError,
    historyOpen,
    setHistoryOpen,
    activityOpen,
    setActivityOpen,
    searchOpen,
    setSearchOpen,
    deleteTarget,
    setDeleteTarget,
    workspace,
    showTranscript,
    activity,
    recents,
    activeSurface,
    surfaceTasks,
    surfaceNotes,
    surfaceFiles,
    command,
    setCommand,
    lastUser,
    lastAssistant,
    pendingRetryUserId,
    handleNewSession,
    handleSelect,
    handleRename,
    confirmDelete,
    handleStop,
    handleSend,
    handleRetry,
    returnHome,
    openNoteById,
    applyCoreDeepLink,
    loadConversations,
    loadMessages,
  };
}
