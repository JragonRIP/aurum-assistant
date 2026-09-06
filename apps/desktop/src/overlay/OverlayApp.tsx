import { useCallback, useEffect, useRef, useState } from "react";
import {
  AurumPresence,
  type PresencePresentation,
  type PresenceState,
  defaultPhaseActivity,
  isResearchTool,
  resolveWorkingActivity,
  resolveWorkingHeadline,
  shouldShowIdlePrompt,
} from "@aurum/ui";
import {
  approvalConfirmVerb,
  approvalDetail,
  approvalPrimaryLabel,
} from "./approval-copy";

/** Compact reply threshold — keep in sync with main/overlay-layout.ts */
function shouldOfferShowFull(reply: string): boolean {
  const text = reply.trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/).length;
  return text.length >= 420 || lines >= 10;
}

type OverlayInfo = {
  paired: boolean;
  online: boolean;
  product?: string;
};

type NowPlaying = {
  title: string;
  artist?: string;
  playing?: boolean;
};

type ResearchSource = {
  title: string;
  url: string;
  domain: string;
};

type StreamEvent = {
  type: string;
  state?: string;
  text?: string;
  tool?: string;
  approvalId?: string;
  executionId?: string;
  display?: { label?: string; detail?: string };
  data?: Record<string, unknown>;
  error?: { message?: string; code?: string };
  message?: { content?: string };
  outcome?: { usedFallbackResponse?: boolean; warning?: string };
};

type PendingApproval = {
  approvalId: string;
  tool: string;
  label: string;
  detail: string;
  confirmVerb: string;
};

type LayoutMode = "idle" | "compact" | "full";

function mapPresence(opts: {
  streaming: boolean;
  acting: boolean;
  awaitingApproval: boolean;
  awaitingUser: boolean;
  error: string | null;
  offline: boolean;
}): { state: PresenceState; presentation: PresencePresentation } {
  if (opts.offline) return { state: "OFFLINE", presentation: "offline" };
  // Waiting for the user outranks error — pending input is not failure
  if (opts.awaitingApproval) {
    return { state: "WAITING_FOR_APPROVAL", presentation: "hold" };
  }
  if (opts.awaitingUser) {
    return { state: "WAITING_FOR_USER", presentation: "awaiting" };
  }
  if (opts.error && !opts.streaming) {
    return { state: "ERROR", presentation: "error" };
  }
  if (opts.acting) return { state: "ACTING", presentation: "acting" };
  if (opts.streaming) return { state: "THINKING", presentation: "thinking" };
  return { state: "IDLE", presentation: "idle" };
}

export function OverlayApp() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [paired, setPaired] = useState(false);
  const [online, setOnline] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState("READY");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [acting, setActing] = useState(false);
  const [successFlash, setSuccessFlash] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [layoutFull, setLayoutFull] = useState(false);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [activityLine, setActivityLine] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [shellVisible, setShellVisible] = useState(false);
  const [shellHiding, setShellHiding] = useState(false);
  const [approvalQueue, setApprovalQueue] = useState<PendingApproval[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [awaitingUser, setAwaitingUser] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const inFlightTools = useRef(new Set<string>());
  const awaitingApprovalRef = useRef(false);
  const awaitingUserRef = useRef(false);
  const replyRef = useRef("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const layoutTimer = useRef<number | null>(null);
  const hideAcked = useRef(false);
  const activityFadeRef = useRef<number | null>(null);

  const pendingApproval = approvalQueue[0] ?? null;
  const awaitingApproval = Boolean(pendingApproval);

  const setActivitySmooth = useCallback((next: string | null) => {
    if (activityFadeRef.current) window.clearTimeout(activityFadeRef.current);
    setActivityLine(next);
  }, []);

  useEffect(() => {
    awaitingApprovalRef.current = awaitingApproval;
  }, [awaitingApproval]);

  useEffect(() => {
    awaitingUserRef.current = awaitingUser;
  }, [awaitingUser]);

  useEffect(() => {
    replyRef.current = reply;
  }, [reply]);

  const refresh = useCallback(async () => {
    try {
      const info = (await window.aurumDesktop.getInfo()) as OverlayInfo;
      setPaired(Boolean(info.paired));
      setOnline(Boolean(info.online));
      if (!info.paired) setStatus("CONNECT");
      else if (!info.online) setStatus("OFFLINE");
      else if (!streaming && !awaitingApprovalRef.current) setStatus("READY");
    } catch {
      if (!awaitingApprovalRef.current) setStatus("READY");
    }
  }, [streaming]);

  useEffect(() => {
    void refresh();
    const unsubShown = window.aurumDesktop.onOverlayShown?.((state) => {
      setPaired(state.paired);
      setOnline(state.online);
      hideAcked.current = false;
      setShellHiding(false);
      if (state.animate === false) {
        setShellVisible(true);
      } else {
        setShellVisible(false);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setShellVisible(true));
        });
      }
      if (!awaitingApprovalRef.current) {
        setError(null);
        if (!state.paired) setStatus("CONNECT");
        else setStatus(state.online ? "READY" : "OFFLINE");
      }
      window.setTimeout(() => inputRef.current?.focus(), 40);
    });
    const unsubHide = window.aurumDesktop.onOverlayWillHide?.(() => {
      hideAcked.current = false;
      setShellHiding(true);
      setShellVisible(false);
      const finish = () => {
        if (hideAcked.current) return;
        hideAcked.current = true;
        void window.aurumDesktop.notifyOverlayHideComplete?.();
      };
      window.setTimeout(finish, 240);
    });
    return () => {
      unsubShown?.();
      unsubHide?.();
    };
  }, [refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Esc never approves. With a pending approval: hide overlay only;
      // the approval stays PENDING in the backend for the full app / later.
      if (awaitingApprovalRef.current) {
        void window.aurumDesktop.hideOverlay();
        return;
      }
      if (streaming) {
        abortRef.current?.();
        setStreaming(false);
        setActing(false);
        setResearching(false);
        setActivitySmooth(null);
        inFlightTools.current.clear();
        setStatus("READY");
        return;
      }
      void window.aurumDesktop.hideOverlay();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [streaming]);

  const pushLayout = useCallback((mode: LayoutMode, contentHeightPx?: number) => {
    void window.aurumDesktop.setOverlayLayout?.({
      mode,
      contentHeightPx,
      expanded: mode !== "idle",
    });
  }, []);

  useEffect(() => {
    const mode: LayoutMode = !expanded
      ? "idle"
      : layoutFull
        ? "full"
        : "compact";
    if (layoutTimer.current) window.clearTimeout(layoutTimer.current);
    layoutTimer.current = window.setTimeout(() => {
      const h = bodyRef.current?.scrollHeight;
      pushLayout(mode, typeof h === "number" ? h : undefined);
    }, streaming ? 180 : 40);
    return () => {
      if (layoutTimer.current) window.clearTimeout(layoutTimer.current);
    };
  }, [expanded, layoutFull, reply, pendingApproval, sourcesOpen, streaming, pushLayout]);

  const presence = mapPresence({
    streaming,
    acting,
    awaitingApproval,
    awaitingUser,
    error,
    offline: paired && !online && !streaming && !awaitingApproval,
  });
  const presentation = successFlash ? "success" : presence.presentation;

  async function handlePair() {
    const code = pairCode.trim();
    if (!code) return;
    setStatus("PAIRING");
    const res = await window.aurumDesktop.pairDevice(code);
    if (!res.ok) {
      setStatus("FAILED");
      setError(res.error ?? "Pairing failed");
      return;
    }
    setPairCode("");
    setError(null);
    setPaired(true);
    setStatus("READY");
    await refresh();
  }

  function enqueueApproval(event: StreamEvent) {
    const approvalId = event.approvalId;
    if (!approvalId || typeof approvalId !== "string") return;
    const tool = event.tool ?? "action";
    const next: PendingApproval = {
      approvalId,
      tool,
      label: approvalPrimaryLabel(tool, event.display?.label),
      detail: event.display?.detail ?? approvalDetail(tool),
      confirmVerb: approvalConfirmVerb(tool),
    };
    setApprovalQueue((prev) => {
      if (prev.some((p) => p.approvalId === approvalId)) return prev;
      return [...prev, next];
    });
    setActing(false);
    setError(null);
    setStatus("WAITING FOR APPROVAL");
    setExpanded(true);
  }

  function applyEvent(event: StreamEvent) {
    if (event.type === "approval_required") {
      setActivitySmooth(null);
      enqueueApproval(event);
      return;
    }
    if (event.type === "status") {
      if (awaitingApprovalRef.current) return;
      if (event.state === "acting") {
        if (inFlightTools.current.size > 0) setActing(true);
      }
      if (event.state === "thinking" || event.state === "responding") {
        if (inFlightTools.current.size === 0) setActing(false);
        if (event.state === "thinking") {
          if (inFlightTools.current.size === 0 && !replyRef.current) {
            setActivitySmooth(defaultPhaseActivity("thinking"));
          } else if (inFlightTools.current.size === 0 && replyRef.current) {
            setActivitySmooth("Putting that together...");
          }
        }
        if (event.state === "responding") {
          setActivitySmooth(null);
        }
      }
      return;
    }
    if (event.type === "tool_requested" || event.type === "tool_started") {
      if (awaitingApprovalRef.current) return;
      const key = event.tool ?? "tool";
      inFlightTools.current.add(key);
      setActing(true);
      setExpanded(true);
      setResearching(
        [...inFlightTools.current].some((t) => isResearchTool(t)),
      );
      setActivitySmooth(
        resolveWorkingActivity({
          tool: event.tool,
          displayLabel: event.display?.label ?? event.display?.detail,
        }),
      );
      return;
    }
    if (event.type === "tool_succeeded") {
      const key = event.tool ?? "tool";
      inFlightTools.current.delete(key);
      setActing(inFlightTools.current.size > 0);
      setResearching(
        [...inFlightTools.current].some((t) => isResearchTool(t)),
      );
      if (!awaitingApprovalRef.current) {
        if (inFlightTools.current.size === 0) {
          setActivitySmooth("Putting that together...");
        } else {
          const nextTool = [...inFlightTools.current][0];
          setActivitySmooth(resolveWorkingActivity({ tool: nextTool }));
        }
      }
      const data = event.data;
      if (data && typeof data === "object") {
        const title =
          typeof data.name === "string"
            ? data.name
            : typeof data.trackName === "string"
              ? data.trackName
              : null;
        const artists = Array.isArray(data.artists)
          ? data.artists.filter((a): a is string => typeof a === "string")
          : [];
        if (title && event.tool?.includes("spotify")) {
          setNowPlaying({
            title,
            artist: artists[0],
            playing:
              event.tool === "spotify_play_track" ||
              event.tool === "spotify_resume",
          });
        }
        if (event.tool === "spotify_pause") {
          setNowPlaying((prev) =>
            prev ? { ...prev, playing: false } : prev,
          );
        }
        if (event.tool === "web_search" && Array.isArray(data.results)) {
          const nextSources: ResearchSource[] = [];
          for (const row of data.results) {
            if (!row || typeof row !== "object") continue;
            const item = row as Record<string, unknown>;
            const url = typeof item.url === "string" ? item.url : "";
            const titleText = typeof item.title === "string" ? item.title : "";
            const domain =
              typeof item.domain === "string"
                ? item.domain
                : url
                  ? (() => {
                      try {
                        return new URL(url).hostname.replace(/^www\./, "");
                      } catch {
                        return "";
                      }
                    })()
                  : "";
            if (!url || !titleText) continue;
            nextSources.push({ title: titleText, url, domain });
          }
          if (nextSources.length > 0) {
            setSources(nextSources);
            setSourcesOpen(false);
          }
        }
      }
      return;
    }
    if (event.type === "tool_failed") {
      const key = event.tool ?? "tool";
      inFlightTools.current.delete(key);
      setActing(inFlightTools.current.size > 0);
      setResearching(
        [...inFlightTools.current].some((t) => isResearchTool(t)),
      );
      // APPROVAL_REQUIRED / soft playback / clarifications — never ERROR
      if (
        event.error?.code === "APPROVAL_REQUIRED" ||
        event.error?.code === "AMBIGUOUS_TRACK" ||
        event.error?.code === "AMBIGUOUS_PLAYLIST" ||
        event.error?.code === "AMBIGUOUS_MATCH" ||
        event.error?.code === "PLAYBACK_CHANGE_NOT_CONFIRMED" ||
        event.error?.code === "RATE_LIMITED" ||
        awaitingApprovalRef.current ||
        awaitingUserRef.current
      ) {
        if (
          event.error?.code === "AMBIGUOUS_TRACK" ||
          event.error?.code === "AMBIGUOUS_PLAYLIST" ||
          event.error?.code === "AMBIGUOUS_MATCH"
        ) {
          setAwaitingUser(true);
          setError(null);
          setActivitySmooth(null);
          if (event.error?.message) {
            setReply(event.error.message);
            setExpanded(true);
          }
        } else if (
          event.error?.code === "PLAYBACK_CHANGE_NOT_CONFIRMED" ||
          event.error?.code === "RATE_LIMITED"
        ) {
          setError(null);
          setActivitySmooth(null);
          if (event.error?.message) {
            setReply(event.error.message);
            setExpanded(true);
          }
        }
        return;
      }
      setActivitySmooth(null);
      setError(event.error?.message ?? event.display?.detail ?? "Action failed");
      return;
    }
    if (event.type === "clarification_needed") {
      const key = event.tool ?? "tool";
      inFlightTools.current.delete(key);
      setActing(inFlightTools.current.size > 0);
      setResearching(
        [...inFlightTools.current].some((t) => isResearchTool(t)),
      );
      setAwaitingUser(true);
      setError(null);
      setActivitySmooth(null);
      const detail =
        event.display?.detail ??
        event.error?.message ??
        "Which one did you mean?";
      setReply(detail);
      setExpanded(true);
      return;
    }
    if (event.type === "delta" && event.text) {
      setActivitySmooth(null);
      setReply((prev) => prev + event.text!);
      setExpanded(true);
      return;
    }
    if (event.type === "done") {
      setActivitySmooth(null);
      if (event.message?.content && !replyRef.current) {
        setReply(event.message.content);
      }
      if (
        event.outcome?.warning &&
        !awaitingApprovalRef.current &&
        !awaitingUserRef.current
      ) {
        setError(event.outcome.warning);
      }
      if (awaitingApprovalRef.current) {
        setActing(false);
        return;
      }
      if (awaitingUserRef.current) {
        setActing(false);
        setError(null);
        return;
      }
      setSuccessFlash(true);
      window.setTimeout(() => setSuccessFlash(false), 700);
      return;
    }
    if (event.type === "error") {
      if (awaitingApprovalRef.current || awaitingUserRef.current) return;
      setActivitySmooth(null);
      setError(event.error?.message ?? "Something went wrong");
    }
  }

  async function resolveApproval(decision: "approve" | "reject") {
    const current = approvalQueue[0];
    if (!current || approvalBusy) return;
    const remainingAfter = approvalQueue.length - 1;
    setApprovalBusy(true);
    setError(null);
    try {
      const res = await window.aurumDesktop.decideOverlayApproval?.(
        current.approvalId,
        decision,
      );
      if (!res) {
        setError("Approval is unavailable in this build.");
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Could not update approval.");
        if (
          res.code === "EXPIRED" ||
          res.code === "APPROVAL_EXPIRED" ||
          res.code === "ALREADY_RESOLVED" ||
          res.code === "APPROVAL_ALREADY_RESOLVED" ||
          res.code === "NOT_PENDING"
        ) {
          setApprovalQueue((q) => q.slice(1));
          if (remainingAfter > 0) {
            setStatus("WAITING FOR APPROVAL");
          }
        }
        return;
      }

      setApprovalQueue((q) => q.slice(1));

      if (remainingAfter > 0) {
        setStatus("WAITING FOR APPROVAL");
        setActing(false);
        if (decision === "reject") {
          setReply("Cancelled. Next approval ready.");
        }
        return;
      }

      if (decision === "reject") {
        setReply("Cancelled.");
        setStatus("READY");
        setActing(false);
        return;
      }

      const activity =
        res.result?.activityLabel ??
        res.result?.message ??
        (res.result?.success ? "Done." : null);
      if (res.result?.success) {
        setReply(activity ?? "Done.");
        setStatus((activity ?? "DONE").toUpperCase());
        setSuccessFlash(true);
        window.setTimeout(() => setSuccessFlash(false), 700);
        setActing(false);
      } else {
        setError(
          res.result?.error?.message ??
            res.result?.message ??
            "Approved, but the action failed.",
        );
        setStatus("ERROR");
        setActing(false);
      }
    } finally {
      setApprovalBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }

  async function handleSubmit() {
    const text = command.trim();
    if (!text || streaming || awaitingApproval) return;
    if (!paired) {
      setStatus("CONNECT");
      return;
    }
    setCommand("");
    setReply("");
    setError(null);
    setAwaitingUser(false);
    setStreaming(true);
    setActing(false);
    setStatus("THINKING");
    setActivitySmooth(defaultPhaseActivity("thinking"));
    setExpanded(true);
    setLayoutFull(false);
    setSources([]);
    setSourcesOpen(false);
    setApprovalQueue([]);
    setResearching(false);
    inFlightTools.current.clear();

    const handle = await window.aurumDesktop.startOverlayChat(text);
    abortRef.current = () => {
      void window.aurumDesktop.cancelOverlayChat?.(handle.id);
    };

    const unsub = window.aurumDesktop.onOverlayChatEvent?.((payload) => {
      if (payload.id !== handle.id) return;
      if (payload.event) applyEvent(payload.event as StreamEvent);
      if (payload.done || payload.error) {
        setStreaming(false);
        setActing(false);
        inFlightTools.current.clear();
        setResearching(false);
        setActivitySmooth(null);
        if (awaitingApprovalRef.current) {
          setStatus("WAITING FOR APPROVAL");
        } else if (awaitingUserRef.current) {
          setStatus("NEED YOUR INPUT");
          setError(null);
        } else if (payload.error) {
          setError(payload.error);
          setStatus("ERROR");
        } else if (!error) {
          setStatus("READY");
        }
        unsub?.();
        abortRef.current = null;
        window.setTimeout(() => inputRef.current?.focus(), 40);
      }
    });
  }

  if (!paired) {
    return (
      <div
        className={`overlay-shell${shellVisible ? " visible" : ""}${
          shellHiding ? " hiding" : ""
        }`}
      >
        <div className="overlay-panel">
          <div className="overlay-core">
            <AurumPresence state="OFFLINE" size="md" presentation="offline" />
          </div>
          <div className="overlay-status">CONNECT AURUM</div>
          <div className="overlay-pair">
            <input
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value)}
              placeholder="PAIRING CODE"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handlePair();
              }}
            />
            <button
              type="button"
              className="overlay-btn"
              onClick={() => void handlePair()}
            >
              Connect
            </button>
          </div>
          <div className="overlay-hint">
            Enter the code from Aurum → Devices
          </div>
        </div>
      </div>
    );
  }

  const showIdlePrompt = shouldShowIdlePrompt({
    streaming,
    acting,
    awaitingApproval,
    awaitingUser,
    error: Boolean(error) && !streaming && !awaitingApproval && !awaitingUser,
  });

  const workingHeadline =
    status === "CONNECT" ||
    status === "OFFLINE" ||
    status === "PAIRING" ||
    status === "FAILED"
      ? status
      : resolveWorkingHeadline({
          awaitingApproval,
          awaitingUser,
          error: Boolean(error) && !streaming && !awaitingApproval && !awaitingUser,
          researching,
          acting,
          streaming,
          hasReply: Boolean(reply),
        });

  const showBody =
    reply ||
    error ||
    nowPlaying ||
    streaming ||
    pendingApproval ||
    sources.length > 0 ||
    Boolean(activityLine);
  const offerShowFull = shouldOfferShowFull(reply);
  const layoutClass = !expanded
    ? "layout-idle"
    : layoutFull
      ? "layout-full"
      : "layout-compact";
  const inputSecondary =
    streaming || acting || awaitingApproval || awaitingUser;

  return (
    <div
      className={`overlay-shell ${layoutClass}${shellVisible ? " visible" : ""}${
        shellHiding ? " hiding" : ""
      }${inputSecondary ? " is-working" : ""}`}
    >
      <div className="overlay-panel">
        <div className="overlay-core">
          <AurumPresence
            state={presence.state}
            size="md"
            presentation={presentation}
          />
        </div>
        <div
          className={`overlay-status${
            error && !streaming && !awaitingApproval && !awaitingUser
              ? " error"
              : ""
          }`}
        >
          {workingHeadline}
        </div>
        {activityLine && !awaitingApproval && !reply ? (
          <div className="overlay-activity" key={activityLine}>
            {activityLine}
          </div>
        ) : null}
        <input
          ref={inputRef}
          className={`overlay-command${inputSecondary ? " is-secondary" : ""}`}
          value={command}
          placeholder={showIdlePrompt ? "What do you need?" : ""}
          aria-label={showIdlePrompt ? "What do you need?" : "Ask Aurum"}
          disabled={streaming || awaitingApproval}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
          }}
        />
        {showBody ? (
          <div className="overlay-body" ref={bodyRef}>
            {activityLine &&
            !awaitingApproval &&
            reply &&
            (streaming || acting) ? (
              <div
                className="overlay-activity overlay-activity--inline"
                key={`inline-${activityLine}`}
              >
                {activityLine}
              </div>
            ) : null}
            {pendingApproval ? (
              <div className="overlay-approval" role="dialog" aria-modal="true">
                <div className="overlay-approval-title">
                  {pendingApproval.label}
                </div>
                <div className="overlay-approval-detail">
                  {pendingApproval.detail}
                </div>
                <div className="overlay-approval-actions">
                  <button
                    type="button"
                    className="overlay-btn overlay-btn-primary"
                    disabled={approvalBusy}
                    onClick={() => void resolveApproval("approve")}
                  >
                    {approvalBusy
                      ? "Working…"
                      : pendingApproval.confirmVerb}
                  </button>
                  <button
                    type="button"
                    className="overlay-btn"
                    disabled={approvalBusy}
                    onClick={() => void resolveApproval("reject")}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {!pendingApproval && reply ? (
              <div className="overlay-reply">{reply}</div>
            ) : null}
            {error ? (
              <div className="overlay-reply" style={{ color: "var(--error)" }}>
                {error}
              </div>
            ) : null}
            {nowPlaying && !pendingApproval ? (
              <div className="overlay-now">
                <div className="overlay-now-title">{nowPlaying.title}</div>
                <div className="overlay-now-sub">
                  {[
                    nowPlaying.artist,
                    nowPlaying.playing === false ? "Paused" : "Playing",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            ) : null}
            {!pendingApproval && sources.length > 0 ? (
              <div className="overlay-sources">
                <button
                  type="button"
                  className="overlay-btn"
                  onClick={() => setSourcesOpen((v) => !v)}
                >
                  {sourcesOpen
                    ? "Hide sources"
                    : `Sources · ${sources.length}`}
                </button>
                {sourcesOpen ? (
                  <div className="overlay-sources-list">
                    {sources.map((s) => (
                      <div className="overlay-source-row" key={s.url}>
                        <span className="overlay-source-title">
                          {s.domain || s.title}
                          {s.title && s.domain ? ` — ${s.title}` : ""}
                        </span>
                        <button
                          type="button"
                          className="overlay-btn"
                          onClick={() =>
                            void window.aurumDesktop.openExternal?.(s.url)
                          }
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!pendingApproval && (offerShowFull || reply.length > 120) ? (
              <div className="overlay-actions">
                {offerShowFull ? (
                  <button
                    type="button"
                    className="overlay-btn"
                    onClick={() => setLayoutFull((v) => !v)}
                  >
                    {layoutFull ? "Collapse" : "Show full"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="overlay-btn"
                  onClick={() => void window.aurumDesktop.openInAurum?.()}
                >
                  Open in Aurum
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {showIdlePrompt && !streaming && !reply && !error && !pendingApproval ? (
          <div className="overlay-hint">Enter to send · Esc to dismiss</div>
        ) : null}
        {pendingApproval ? (
          <div className="overlay-hint">
            Approve or Cancel · Esc hides overlay (approval stays pending)
          </div>
        ) : null}
      </div>
    </div>
  );
}
