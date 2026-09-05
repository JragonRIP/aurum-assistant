"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge, Button } from "@aurum/ui";
import { ConversationSidebar } from "./ConversationSidebar";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { AssistantEmptyState } from "./EmptyState";
import type { UiConversation, UiMessage } from "./types";
import {
  applyConversationListFetch,
  createGenerationAbortController,
  isAbortError,
} from "@/lib/conversations/list-state";
import { StreamingTextController } from "@/lib/conversations/streaming-text";
import { reconcileAssistantMessage } from "@/lib/conversations/reconcile-message";

interface AssistantViewProps {
  aiConfigured: boolean;
}

type CoreStatus = "idle" | "thinking" | "responding" | "error";

type StreamEvent =
  | {
      type: "status";
      state: "thinking" | "responding";
      timings?: Record<string, number>;
    }
  | { type: "ready"; timings?: Record<string, number> }
  | { type: "user_message"; message: UiMessage }
  | { type: "assistant_start"; generationId?: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      message: UiMessage;
      title?: string;
      generationId?: string;
      timings?: Record<string, number>;
    }
  | { type: "error"; error: string; code?: string }
  | { type: "title"; title: string }
  | { type: "timing"; name: string; ms: number };

function newGenerationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function AssistantView({ aiConfigured }: AssistantViewProps) {
  const [conversations, setConversations] = useState<UiConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [coreStatus, setCoreStatus] = useState<CoreStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UiConversation | null>(null);
  const [pendingRetryUserId, setPendingRetryUserId] = useState<string | null>(
    null,
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const revealRef = useRef<StreamingTextController | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<UiConversation[]>([]);
  const streamDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("debugStream");

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming, scrollToBottom]);

  const loadConversations = useCallback(async (): Promise<{
    ok: boolean;
    conversations: UiConversation[];
  }> => {
    setLoadingList(true);
    try {
      const forceError =
        process.env.NODE_ENV === "development" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("forceListError") ===
          "1";
      const res = await fetch(
        forceError ? "/api/conversations?forceError=1" : "/api/conversations",
      );
      if (res.status === 401) {
        setListError("Session expired. Sign in again.");
        return {
          ok: false,
          conversations: conversationsRef.current,
        };
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Failed to load conversations");
      }
      const data = (await res.json()) as { conversations: UiConversation[] };
      const merged = applyConversationListFetch({
        previous: conversationsRef.current,
        result: { ok: true, conversations: data.conversations },
      });
      setConversations(merged.conversations);
      setListError(null);
      return { ok: true, conversations: merged.conversations };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load conversations";
      const merged = applyConversationListFetch({
        previous: conversationsRef.current,
        result: { ok: false, error: message },
      });
      setConversations(merged.conversations);
      setListError(message);
      return { ok: false, conversations: merged.conversations };
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Failed to load messages");
      }
      const data = (await res.json()) as { messages: UiMessage[] };
      if (selectedIdRef.current === conversationId) {
        setMessages(data.messages);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const result = await loadConversations();
      if (result.ok && result.conversations[0]) {
        setSelectedId(result.conversations[0].id);
        await loadMessages(result.conversations[0].id);
      }
    })();
  }, [loadConversations, loadMessages]);

  async function handleNewConversation() {
    setError(null);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      setError("Could not create conversation");
      return;
    }
    const data = (await res.json()) as { conversation: UiConversation };
    setConversations((prev) => [data.conversation, ...prev]);
    setSelectedId(data.conversation.id);
    setMessages([]);
    setHistoryOpen(false);
  }

  async function handleSelect(id: string) {
    if (streaming) return;
    setSelectedId(id);
    setHistoryOpen(false);
    await loadMessages(id);
  }

  async function handleRename(id: string, title: string) {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setError("Could not rename conversation");
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
      setError("Could not delete conversation");
      return;
    }
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (selectedId === id) {
      const next = remaining[0] ?? null;
      setSelectedId(next?.id ?? null);
      if (next) await loadMessages(next.id);
      else setMessages([]);
    }
  }

  function stopReveal() {
    revealRef.current?.cancel();
    revealRef.current = null;
  }

  function handleStop() {
    stopReveal();
    const controller = generationAbortRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    setStreaming(false);
    setCoreStatus("idle");
    setMessages((prev) =>
      prev.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              status: "partial",
              metadata: { ...m.metadata, cancelled: true },
            }
          : m,
      ),
    );
  }

  async function runGeneration(opts: {
    conversationId: string;
    content?: string;
    retryOfUserMessageId?: string;
    generationId: string;
    localAssistantId: string;
    clientSentAt: number;
  }) {
    setStreaming(true);
    setCoreStatus("thinking");
    setError(null);
    setPendingRetryUserId(null);

    const controller = createGenerationAbortController();
    generationAbortRef.current = controller;

    const clientStarted = performance.now();
    const clientSentAtPerf = clientStarted;
    let firstDeltaReceiveAt: number | null = null;
    let firstWordRenderAt: number | null = null;

    const reveal = new StreamingTextController({
      onReveal: (visible) => {
        if (firstWordRenderAt == null && visible.trim().length > 0) {
          firstWordRenderAt = performance.now() - clientSentAtPerf;
          setCoreStatus("responding");
          if (streamDebug || process.env.NODE_ENV === "development") {
            console.info("[aurum:client-latency]", {
              event: "first_word_rendered",
              ms: Math.round(firstWordRenderAt),
            });
          }
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === opts.localAssistantId
              ? { ...m, content: visible, streaming: true }
              : m,
          ),
        );
      },
    });
    revealRef.current = reveal;

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: opts.conversationId,
          content: opts.content,
          retryOfUserMessageId: opts.retryOfUserMessageId,
          generationId: opts.generationId,
          clientSentAt: opts.clientSentAt,
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

          if (event.type === "timing" && streamDebug) {
            console.info("[aurum:client-stream]", event);
          }

          if (event.type === "status") {
            if (event.state === "thinking") setCoreStatus("thinking");
            if (event.state === "responding") setCoreStatus("responding");
            continue;
          }

          if (event.type === "ready") {
            if (streamDebug || process.env.NODE_ENV === "development") {
              console.info("[aurum:client-latency]", {
                event: "sse_ready",
                ms: Math.round(performance.now() - clientSentAtPerf),
                serverTimings: event.timings,
              });
            }
            continue;
          }

          if (event.type === "user_message") {
            setMessages((prev) => {
              const filtered = prev.filter(
                (m) =>
                  !(
                    m.id.startsWith("temp-") &&
                    m.content === event.message.content
                  ),
              );
              if (filtered.some((m) => m.id === event.message.id)) {
                return filtered;
              }
              return [...filtered, event.message];
            });
            continue;
          }

          if (event.type === "assistant_start") {
            // Placeholder already created client-side with generationId — do not append another.
            setMessages((prev) => {
              if (
                prev.some(
                  (m) =>
                    m.id === opts.localAssistantId ||
                    m.metadata?.generationId === opts.generationId,
                )
              ) {
                return prev;
              }
              return [
                ...prev,
                {
                  id: opts.localAssistantId,
                  conversation_id: opts.conversationId,
                  user_id: "",
                  role: "assistant",
                  content: "",
                  status: "complete",
                  metadata: { generationId: opts.generationId },
                  created_at: new Date().toISOString(),
                  streaming: true,
                },
              ];
            });
            continue;
          }

          if (event.type === "delta") {
            if (firstDeltaReceiveAt == null) {
              firstDeltaReceiveAt = performance.now() - clientSentAtPerf;
              if (streamDebug || process.env.NODE_ENV === "development") {
                console.info("[aurum:client-latency]", {
                  event: "first_sse_delta_received",
                  ms: Math.round(firstDeltaReceiveAt),
                  chars: event.text.length,
                });
              }
            }
            // Enqueue real text only — reveal controller never invents ahead.
            reveal.enqueue(event.text);
            continue;
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
            continue;
          }

          if (event.type === "done") {
            const finalMsg = event.message;
            await new Promise<void>((resolve) => {
              reveal.finish(() => resolve());
            });
            setMessages((prev) =>
              reconcileAssistantMessage({
                previous: prev,
                localAssistantId: opts.localAssistantId,
                generationId: opts.generationId,
                serverMessage: {
                  ...finalMsg,
                  streaming: false,
                  metadata: {
                    ...finalMsg.metadata,
                    generationId: opts.generationId,
                  },
                },
              }),
            );
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
            if (streamDebug || process.env.NODE_ENV === "development") {
              console.info("[aurum:client-latency]", {
                event: "done",
                totalMs: Math.round(performance.now() - clientSentAtPerf),
                firstDeltaMs: firstDeltaReceiveAt
                  ? Math.round(firstDeltaReceiveAt)
                  : null,
                firstWordMs: firstWordRenderAt
                  ? Math.round(firstWordRenderAt)
                  : null,
                serverTimings: event.timings,
              });
            }
            continue;
          }

          if (event.type === "error") {
            setError(event.error);
            setCoreStatus("error");
            setMessages((prev) => {
              const lastUser = [...prev]
                .reverse()
                .find((m) => m.role === "user");
              if (lastUser) setPendingRetryUserId(lastUser.id);
              return prev.map((m) =>
                m.id === opts.localAssistantId ||
                m.metadata?.generationId === opts.generationId
                  ? {
                      ...m,
                      streaming: false,
                      status: "error",
                      metadata: { ...m.metadata, failed: true },
                      content:
                        m.content || event.error || "Generation failed.",
                    }
                  : m,
              );
            });
          }
        }
      }
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        stopReveal();
        setMessages((prev) =>
          prev.map((m) =>
            m.streaming ||
            m.id === opts.localAssistantId ||
            m.metadata?.generationId === opts.generationId
              ? {
                  ...m,
                  streaming: false,
                  status: "partial",
                  metadata: { ...m.metadata, cancelled: true },
                }
              : m,
          ),
        );
      } else {
        stopReveal();
        const message =
          err instanceof Error ? err.message : "Generation failed";
        setError(message);
        setCoreStatus("error");
        setMessages((prev) => {
          const lastUser = [...prev].reverse().find((m) => m.role === "user");
          if (lastUser) setPendingRetryUserId(lastUser.id);
          return prev.map((m) =>
            m.id === opts.localAssistantId ||
            m.metadata?.generationId === opts.generationId
              ? {
                  ...m,
                  streaming: false,
                  status: "error" as const,
                  metadata: { ...m.metadata, failed: true },
                  content: m.content || message,
                }
              : m,
          );
        });
      }
    } finally {
      if (revealRef.current === reveal) {
        revealRef.current = null;
      }
      setStreaming(false);
      setCoreStatus((s) => (s === "error" ? "error" : "idle"));
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }
    }
  }

  async function handleSend(text: string) {
    const clientSentAt = Date.now();
    // Immediate feedback — before any network await
    setCoreStatus("thinking");
    setStreaming(true);
    setError(null);

    let conversationId = selectedId;
    if (!conversationId) {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError("Could not create conversation");
        setStreaming(false);
        setCoreStatus("error");
        return;
      }
      const data = (await res.json()) as { conversation: UiConversation };
      conversationId = data.conversation.id;
      setConversations((prev) => [data.conversation, ...prev]);
      setSelectedId(conversationId);
      setMessages([]);
    }

    const generationId = newGenerationId();
    const localAssistantId = `local-assistant-${generationId}`;
    const tempUserId = `temp-${generationId}`;

    setMessages((prev) => [
      ...prev,
      {
        id: tempUserId,
        conversation_id: conversationId!,
        user_id: "",
        role: "user",
        content: text,
        status: "complete",
        metadata: { generationId },
        created_at: new Date().toISOString(),
      },
      {
        id: localAssistantId,
        conversation_id: conversationId!,
        user_id: "",
        role: "assistant",
        content: "",
        status: "complete",
        metadata: { generationId },
        created_at: new Date().toISOString(),
        streaming: true,
      },
    ]);

    await runGeneration({
      conversationId,
      content: text,
      generationId,
      localAssistantId,
      clientSentAt,
    });

    setMessages((prev) => {
      const real = prev.find(
        (m) =>
          m.role === "user" &&
          m.content === text &&
          !m.id.startsWith("temp-"),
      );
      if (real) return prev.filter((m) => m.id !== tempUserId);
      return prev;
    });
  }

  async function handleRetry() {
    if (!selectedId) return;
    const lastUser =
      (pendingRetryUserId
        ? messages.find((m) => m.id === pendingRetryUserId)
        : null) ?? [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    const generationId = newGenerationId();
    const localAssistantId = `local-assistant-${generationId}`;
    const clientSentAt = Date.now();

    setCoreStatus("thinking");
    setStreaming(true);
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === lastUser.id);
      const trimmed = idx >= 0 ? prev.slice(0, idx + 1) : prev;
      return [
        ...trimmed,
        {
          id: localAssistantId,
          conversation_id: selectedId,
          user_id: "",
          role: "assistant",
          content: "",
          status: "complete",
          metadata: { generationId },
          created_at: new Date().toISOString(),
          streaming: true,
        },
      ];
    });

    await runGeneration({
      conversationId: selectedId,
      retryOfUserMessageId: lastUser.id,
      generationId,
      localAssistantId,
      clientSentAt,
    });
  }

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const showEmptyListError =
    Boolean(listError) && conversations.length === 0 && !loadingList;

  const statusLabel = !aiConfigured
    ? "AI offline"
    : coreStatus === "thinking"
      ? "Thinking"
      : coreStatus === "responding"
        ? "Responding"
        : coreStatus === "error" || error
          ? "Error"
          : "Idle";

  const statusTone =
    !aiConfigured
      ? "warning"
      : coreStatus === "thinking" || coreStatus === "responding"
        ? "gold"
        : coreStatus === "error" || error
          ? "danger"
          : "neutral";

  return (
    <div className="flex h-[calc(100dvh-0px)] md:h-screen">
      <aside className="hidden w-[240px] shrink-0 border-r border-[var(--aurum-border)] bg-[var(--aurum-surface)]/50 md:flex md:flex-col">
        {listError ? (
          <div className="border-b border-[var(--aurum-border)] px-3 py-2 text-[11px] text-[var(--aurum-warning)]">
            <div>{listError}</div>
            <button
              type="button"
              className="mt-1 underline"
              onClick={() => void loadConversations()}
            >
              Retry
            </button>
          </div>
        ) : null}
        <ConversationSidebar
          conversations={conversations}
          selectedId={selectedId}
          loading={loadingList}
          onSelect={(id) => void handleSelect(id)}
          onNew={() => void handleNewConversation()}
          onRename={(id, title) => handleRename(id, title)}
          onDelete={(id) => {
            const c = conversations.find((x) => x.id === id) ?? null;
            setDeleteTarget(c);
          }}
        />
      </aside>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close history"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-[var(--aurum-surface)] shadow-[var(--aurum-shadow-overlay)]">
            {listError ? (
              <div className="border-b border-[var(--aurum-border)] px-3 py-2 text-[11px] text-[var(--aurum-warning)]">
                <div>{listError}</div>
                <button
                  type="button"
                  className="mt-1 underline"
                  onClick={() => void loadConversations()}
                >
                  Retry
                </button>
              </div>
            ) : null}
            <ConversationSidebar
              conversations={conversations}
              selectedId={selectedId}
              loading={loadingList}
              onSelect={(id) => void handleSelect(id)}
              onNew={() => void handleNewConversation()}
              onRename={(id, title) => handleRename(id, title)}
              onDelete={(id) => {
                const c = conversations.find((x) => x.id === id) ?? null;
                setDeleteTarget(c);
              }}
            />
          </div>
        </div>
      ) : null}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--aurum-border)] px-4 py-3 md:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-[12px] text-[var(--aurum-text-muted)] md:hidden"
                onClick={() => setHistoryOpen(true)}
              >
                History
              </button>
              <h1
                className="truncate text-[18px] text-[var(--aurum-text)]"
                style={{
                  fontFamily: "var(--aurum-font-display)",
                  fontWeight: 500,
                }}
              >
                {selected?.title || "Assistant"}
              </h1>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--aurum-text-dim)]">
              Device: WEB
            </p>
          </div>
          <div
            className={
              coreStatus === "thinking" || coreStatus === "responding"
                ? "aurum-core-pulse"
                : undefined
            }
          >
            <StatusBadge label={statusLabel} tone={statusTone} />
          </div>
        </header>

        {!aiConfigured ? (
          <div className="mx-4 mt-4 rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border)] bg-[var(--aurum-gold-soft)] px-4 py-3 text-[13px] text-[var(--aurum-gold-bright)] md:mx-6">
            <strong>AI not configured.</strong> Add{" "}
            <code className="text-[var(--aurum-text)]">GEMINI_API_KEY</code> to{" "}
            <code className="text-[var(--aurum-text)]">
              apps/web/.env.local
            </code>{" "}
            and restart the server.
          </div>
        ) : null}

        {showEmptyListError ? (
          <div className="mx-4 mt-3 rounded-[var(--aurum-radius-sm)] border border-[rgba(196,92,92,0.35)] px-4 py-3 text-[13px] text-[var(--aurum-danger)] md:mx-6">
            Could not load conversations.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void loadConversations()}
            >
              Retry
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mx-4 mt-3 rounded-[var(--aurum-radius-sm)] border border-[rgba(196,92,92,0.35)] px-4 py-2 text-[13px] text-[var(--aurum-danger)] md:mx-6">
            {error}
            {pendingRetryUserId ||
            messages.some((m) => m.status === "error") ? (
              <button
                type="button"
                className="ml-3 underline"
                onClick={() => void handleRetry()}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6">
          {loadingMessages && messages.length === 0 ? (
            <p className="text-[13px] text-[var(--aurum-text-dim)]">Loading…</p>
          ) : messages.length === 0 ? (
            <AssistantEmptyState
              disabled={!aiConfigured || streaming}
              onSuggestion={(text) => void handleSend(text)}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              {messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onRetry={
                      m.status === "error" || m.metadata?.failed
                        ? () => void handleRetry()
                        : undefined
                    }
                  />
                ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <Composer
          aiConfigured={aiConfigured}
          disabled={loadingList && conversations.length === 0}
          streaming={streaming}
          onSend={(text) => void handleSend(text)}
          onStop={handleStop}
        />
      </section>

      {deleteTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[var(--aurum-radius-md)] border border-[var(--aurum-border-strong)] bg-[var(--aurum-surface)] p-6 shadow-[var(--aurum-shadow-overlay)]">
            <h2
              className="text-[20px] text-[var(--aurum-text)]"
              style={{ fontFamily: "var(--aurum-font-display)" }}
            >
              Delete conversation?
            </h2>
            <p className="mt-2 text-[14px] text-[var(--aurum-text-muted)]">
              This will permanently delete{" "}
              <strong className="text-[var(--aurum-text)]">
                {deleteTarget.title || "New conversation"}
              </strong>{" "}
              and all of its messages.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void confirmDelete()}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
