"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ActionStatus,
  AurumPresence,
  PRESENCE_STATES,
  BusinessSurface,
  ClientSurface,
  CommandBar,
  FileSurface,
  MemorySurface,
  NativeError,
  ScheduleSurface,
  SearchResultsSurface,
  TaskSurface,
  type PresenceState,
} from "@aurum/ui";
import { ApprovalSurfaceClient } from "./ApprovalSurfaceClient";
import {
  coreLayoutMode,
  coreStatusLine,
  countUnavailableServices,
  derivePresencePresentation,
  derivePresenceState,
  formatGreeting,
  presenceShowsError,
  presenceStatusLabel,
  relativeTimeLabel,
  type ContextualSurfaceKind,
} from "@aurum/shared";
import type { SystemStatusSnapshot } from "@/lib/system/status";
import { useAurum } from "./AurumProvider";
import { AurumMarkdown } from "./AurumMarkdown";
import { CoreToday } from "./CoreToday";
import { SystemHealth } from "./SystemHealth";
import type { UiMessage } from "@/components/assistant/types";
import type { SessionActivity } from "./useAurumSession";

interface AurumCoreProps {
  aiConfigured: boolean;
  status: SystemStatusSnapshot;
}

export function AurumCore({ aiConfigured, status }: AurumCoreProps) {
  const session = useAurum();
  const [greeting, setGreeting] = useState(() =>
    formatGreeting({ displayName: status.displayName }),
  );

  useEffect(() => {
    setGreeting(formatGreeting({ displayName: status.displayName }));
    const id = window.setInterval(() => {
      setGreeting(formatGreeting({ displayName: status.displayName }));
    }, 60_000);
    return () => window.clearInterval(id);
  }, [status.displayName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (session.searchOpen) {
        e.preventDefault();
        session.setSearchOpen(false);
        return;
      }
      if (session.historyOpen) {
        e.preventDefault();
        session.setHistoryOpen(false);
        return;
      }
      if (session.activityOpen) {
        e.preventDefault();
        session.setActivityOpen(false);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    session.searchOpen,
    session.historyOpen,
    session.activityOpen,
    session.setSearchOpen,
    session.setHistoryOpen,
    session.setActivityOpen,
  ]);

  const livePresence = derivePresenceState({
    aiConfigured,
    streaming: session.streaming,
    acting: session.acting,
    awaitingApproval: session.awaitingApproval,
    error: presenceShowsError({
      error: session.error,
      streaming: session.streaming,
    }),
  });
  const presence = useDevPresenceOverride(livePresence);
  const layout = coreLayoutMode({
    workspace: session.workspace,
    streaming: session.streaming,
  });
  const pulse = useCorePulse({
    streaming: session.streaming,
    contentLength: session.lastAssistant?.content.length ?? 0,
    acting: session.acting,
    error: presence === "ERROR",
  });
  const pendingTool = session.activity.find(
    (item) =>
      item.state === "pending" &&
      item.label !== "RESPONDING" &&
      item.label !== "APPROVAL REQUIRED",
  );
  const presentation = derivePresencePresentation({
    state: presence,
    streaming: session.streaming,
    hasResponseText: Boolean(session.lastAssistant?.content),
    acting: session.acting,
    successPulse: pulse === "success",
  });
  const statusLabel =
    presenceStatusLabel({
      presentation,
      toolLabel: pendingTool?.label,
    }) || "AURUM";

  function onCancelCommand() {
    if (session.streaming) {
      session.handleStop();
      return;
    }
    if (session.command) {
      session.setCommand("");
      return;
    }
    if (session.workspace === "session") {
      session.returnHome();
    }
  }

  return (
    <div
      className="aurum-core-stage relative flex min-h-0 flex-1 flex-col"
      data-core-layout={layout}
    >
      <div className="aurum-core-scroll flex min-h-0 flex-1 justify-center px-8 pb-10 md:px-16">
        <div className="flex w-full max-w-xl flex-col">
          <div className="flex flex-col items-center text-center">
            {layout === "active" ? (
              <button
                type="button"
                className="aurum-focus-ring mb-4 text-[13px] text-[var(--aurum-text-muted)]"
                onClick={() => session.returnHome()}
              >
                Aurum
              </button>
            ) : null}
            <div className="aurum-presence-stage" data-pulse={pulse}>
              <AurumPresence
                state={presence}
                size="xl"
                presentation={presentation}
              />
            </div>
            <p
              className="aurum-core-status"
              data-empty={statusLabel ? "false" : "true"}
            >
              {statusLabel}
            </p>
            <h1
              className="aurum-core-greeting mt-5 text-[32px] leading-tight text-[var(--aurum-text)] md:text-[36px]"
              style={{
                fontFamily: "var(--aurum-font-display)",
                fontWeight: 500,
              }}
              aria-hidden={layout === "active"}
            >
              {greeting}
            </h1>
            <div className="aurum-core-health mt-4">
              <SystemHealth
                status={status}
                compactLabel={coreStatusLine({
                  aiOnline: aiConfigured,
                  unavailableCount: countUnavailableServices(status),
                })}
              />
            </div>
            {layout === "active" && session.lastUser?.content ? (
              <p className="aurum-core-query">{session.lastUser.content}</p>
            ) : null}
          </div>

          {layout === "idle" ? (
            <>
              <div className="mt-14">
                <CommandBar
                  value={session.command}
                  onChange={session.setCommand}
                  onSubmit={(text) => void session.handleSend(text)}
                  onCancel={onCancelCommand}
                  streaming={session.streaming}
                  onStop={session.handleStop}
                  placeholder="What do you need?"
                  autoFocus
                  aiConfigured={aiConfigured}
                />
              </div>
              {session.error ? (
                <div className="mt-6">
                  <NativeError
                    title={session.error}
                    onRetry={
                      session.allowFullRetry &&
                      (session.pendingRetryUserId ||
                        session.messages.some((m) => m.status === "error"))
                        ? () => void session.handleRetry()
                        : undefined
                    }
                  />
                </div>
              ) : null}
              {session.responseWarning && !session.error ? (
                <p className="mt-4 text-[13px] text-[var(--aurum-text-muted)]">
                  {session.responseWarning}
                </p>
              ) : null}
              <div className="mt-20 grid gap-14">
                <CoreToday />
                <CoreRecents
                  recents={session.recents}
                  onViewActivity={() => session.setActivityOpen(true)}
                />
              </div>
            </>
          ) : (
            <ActiveWorkspace
              aiConfigured={aiConfigured}
              session={session}
              onCancelCommand={onCancelCommand}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CoreRecents({
  recents,
  onViewActivity,
}: {
  recents: ReturnType<typeof useAurum>["recents"];
  onViewActivity: () => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
          Recent
        </h2>
        <button
          type="button"
          onClick={onViewActivity}
          className="aurum-focus-ring text-[12px] text-[var(--aurum-text-dim)] hover:text-[var(--aurum-text-muted)]"
        >
          View activity
        </button>
      </div>
      {recents.length === 0 ? (
        <p className="text-[15px] text-[var(--aurum-text-muted)]">
          Nothing recent yet.
        </p>
      ) : (
        <ul>
          {recents.map((item) => (
            <li
              key={`${item.entityType}:${item.entityId}`}
              className="border-b border-[var(--aurum-border)] py-3 last:border-0"
            >
              <Link
                href={item.href}
                className="aurum-focus-ring flex items-baseline justify-between gap-6 rounded-sm"
              >
                <span>
                  <span className="block text-[15px] text-[var(--aurum-text)]">
                    {item.title}
                  </span>
                  {item.meta ? (
                    <span className="mt-0.5 block text-[12px] text-[var(--aurum-text-dim)]">
                      {item.kindLabel} · {item.meta}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[12px] text-[var(--aurum-text-dim)]">
                      {item.kindLabel}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[12px] text-[var(--aurum-text-dim)]">
                  {relativeTimeLabel(item.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActiveWorkspace({
  aiConfigured,
  session,
  onCancelCommand,
}: {
  aiConfigured: boolean;
  session: ReturnType<typeof useAurum>;
  onCancelCommand: () => void;
}) {
  const showSurface = session.activeSurface !== "response";

  return (
    <div className="mt-10 flex flex-col gap-10">
      {session.messagesError ? (
        <NativeError
          title="Message history unavailable"
          onRetry={() =>
            session.selectedId
              ? void session.loadMessages(session.selectedId)
              : undefined
          }
        />
      ) : null}

      {session.loadingMessages && session.messages.length === 0 ? (
        <p className="text-[13px] text-[var(--aurum-text-dim)]">Loading</p>
      ) : null}

      <LiveActions items={session.activity} />

      {showSurface ? (
            <ContextualSurface
              kind={session.activeSurface}
              query={session.lastUser?.content}
              tasks={session.surfaceTasks}
              notes={session.surfaceNotes}
              files={session.surfaceFiles}
              awaitingApproval={session.awaitingApproval}
              approvalId={session.pendingApprovalId}
              approvalLabel={session.pendingApprovalLabel}
              onApprovalResolved={session.clearPendingApproval}
            />
      ) : null}

      <Briefing
        assistant={session.lastAssistant}
        streaming={session.streaming}
        error={session.error}
        responseWarning={session.responseWarning}
        allowFullRetry={session.allowFullRetry}
        showTranscript={session.showTranscript}
        messages={session.messages}
        surfaceDominant={showSurface}
        onRetry={() => void session.handleRetry()}
      />

      <div className="pt-4">
        <CommandBar
          value={session.command}
          onChange={session.setCommand}
          onSubmit={(text) => void session.handleSend(text)}
          onCancel={onCancelCommand}
          streaming={session.streaming}
          onStop={session.handleStop}
          placeholder="What do you need?"
          aiConfigured={aiConfigured}
        />
      </div>
    </div>
  );
}

function LiveActions({ items }: { items: SessionActivity[] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(id);
  }, []);

  const live = useMemo(() => {
    return items
      .filter((item) => {
        if (item.state === "pending") return true;
        if (item.state !== "success" && item.state !== "error") return false;
        const t = new Date(item.createdAt).getTime();
        return now - t < 8000;
      })
      .slice(0, 2);
  }, [items, now]);

  if (live.length === 0) return null;

  return (
    <div className="max-w-lg">
      {live.map((item) => (
        <ActionStatus
          key={item.id}
          label={item.label}
          detail={item.detail}
          state={item.state}
          href={item.href}
        />
      ))}
    </div>
  );
}

function ContextualSurface({
  kind,
  query,
  tasks,
  notes,
  files,
  awaitingApproval,
  approvalId,
  approvalLabel,
  onApprovalResolved,
}: {
  kind: ContextualSurfaceKind;
  query?: string;
  tasks?: Array<{
    id: string;
    title: string;
    due?: string;
    status?: string;
    href?: string;
  }>;
  notes?: Array<{
    id: string;
    title?: string | null;
    snippet: string;
    href?: string;
  }>;
  files?: Array<{
    id: string;
    name: string;
    relativePath?: string;
    kind?: string;
  }>;
  awaitingApproval?: boolean;
  approvalId?: string | null;
  approvalLabel?: string | null;
  onApprovalResolved?: () => void;
}) {
  switch (kind) {
    case "task":
      return (
        <TaskSurface
          connected
          tasks={(tasks ?? []).map((t) => ({
            id: t.id,
            title: t.title,
            due: t.due,
            status: t.status,
            href: t.href,
          }))}
        />
      );
    case "schedule":
      return <ScheduleSurface connected={false} />;
    case "client":
      return <ClientSurface connected={false} />;
    case "business":
      return <BusinessSurface connected={false} />;
    case "file":
      return (
        <FileSurface
          connected
          files={(files ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            relativePath: f.relativePath,
            kind: f.kind,
          }))}
        />
      );
    case "memory":
      return <MemorySurface connected={false} />;
    case "approval":
      return (
        <ApprovalSurfaceClient
          pending={Boolean(awaitingApproval || approvalId)}
          approvalId={approvalId}
          actionLabel={approvalLabel}
          onResolved={onApprovalResolved}
        />
      );
    case "search":
      return (
        <SearchResultsSurface query={query} connected results={notes ?? []} />
      );
    default:
      return null;
  }
}

function Briefing({
  assistant,
  streaming,
  error,
  responseWarning,
  allowFullRetry,
  showTranscript,
  messages,
  surfaceDominant,
  onRetry,
}: {
  assistant?: UiMessage;
  streaming: boolean;
  error: string | null;
  responseWarning: string | null;
  allowFullRetry: boolean;
  showTranscript: boolean;
  messages: UiMessage[];
  surfaceDominant: boolean;
  onRetry: () => void;
}) {
  if (showTranscript) {
    const visible = messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );
    return (
      <div className="aurum-panel-enter space-y-8">
        {visible.map((m) =>
          m.role === "user" ? (
            <div key={m.id}>
              <div className="text-[12px] text-[var(--aurum-text-dim)]">You</div>
              <p className="mt-1 text-[14px] text-[var(--aurum-text-muted)]">
                {m.content}
              </p>
            </div>
          ) : (
            <article key={m.id}>
              <div className="mb-2 text-[12px] text-[var(--aurum-gold)]">
                Aurum
                {m.status === "error" ? " · error" : null}
              </div>
              <AurumMarkdown
                content={
                  m.content ||
                  (m.streaming ? "" : m.status === "error" ? "Failed." : "")
                }
              />
              {allowFullRetry &&
              (m.status === "error" || m.metadata?.failed) ? (
                <button
                  type="button"
                  className="mt-3 text-[13px] text-[var(--aurum-gold)]"
                  onClick={onRetry}
                >
                  Retry
                </button>
              ) : null}
            </article>
          ),
        )}
      </div>
    );
  }

  return (
    <div className="aurum-panel-enter min-w-0">
      {assistant ? (
        <article className={surfaceDominant ? "max-w-xl" : undefined}>
          <div
            className={
              surfaceDominant
                ? "mb-2 text-[12px] text-[var(--aurum-text-dim)]"
                : "mb-2 text-[12px] text-[var(--aurum-gold)]"
            }
          >
            Aurum
            {assistant.status === "error" ? " · error" : null}
          </div>
          {assistant.content ? (
            <div
              className={
                surfaceDominant ? "text-[var(--aurum-text-muted)]" : undefined
              }
            >
              <AurumMarkdown content={assistant.content} />
            </div>
          ) : null}
          {allowFullRetry &&
          (assistant.status === "error" || assistant.metadata?.failed) &&
          !streaming ? (
            <button
              type="button"
              className="mt-3 text-[13px] text-[var(--aurum-gold)]"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
        </article>
      ) : null}

      {responseWarning && !streaming ? (
        <p className="mt-3 text-[13px] text-[var(--aurum-text-muted)]">
          {responseWarning}
        </p>
      ) : null}

      {error && !streaming && !assistant ? (
        <NativeError
          title={error}
          onRetry={allowFullRetry ? onRetry : undefined}
        />
      ) : null}
    </div>
  );
}

function useDevPresenceOverride(live: PresenceState): PresenceState {
  const [override, setOverride] = useState<PresenceState | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const raw = new URLSearchParams(window.location.search).get("presence");
    if (!raw) return;
    const next = raw.toUpperCase().replaceAll("-", "_");
    if ((PRESENCE_STATES as readonly string[]).includes(next)) {
      setOverride(next as PresenceState);
    }
  }, []);

  return override ?? live;
}

function useCorePulse(opts: {
  streaming: boolean;
  contentLength: number;
  acting: boolean;
  error: boolean;
}): "none" | "stream" | "success" {
  const [pulse, setPulse] = useState<"none" | "stream" | "success">("none");
  const lastLen = useRef(0);
  const lastStreamAt = useRef(0);
  const wasActing = useRef(false);

  useEffect(() => {
    if (opts.contentLength <= lastLen.current) {
      lastLen.current = opts.contentLength;
      return;
    }
    lastLen.current = opts.contentLength;
    if (!opts.streaming) return;
    const now = Date.now();
    if (now - lastStreamAt.current < 220) return;
    lastStreamAt.current = now;
    setPulse("stream");
    const id = window.setTimeout(() => setPulse("none"), 280);
    return () => window.clearTimeout(id);
  }, [opts.contentLength, opts.streaming]);

  useEffect(() => {
    const finishedActing = wasActing.current && !opts.acting && !opts.error;
    wasActing.current = opts.acting;
    if (!finishedActing) return;
    setPulse("success");
    const id = window.setTimeout(() => setPulse("none"), 720);
    return () => window.clearTimeout(id);
  }, [opts.acting, opts.error]);

  return pulse;
}
