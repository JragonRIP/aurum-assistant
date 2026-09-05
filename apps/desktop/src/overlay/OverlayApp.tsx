import { useCallback, useEffect, useRef, useState } from "react";
import {
  AurumPresence,
  type PresencePresentation,
  type PresenceState,
} from "@aurum/ui";
import {
  approvalConfirmVerb,
  approvalDetail,
  approvalPrimaryLabel,
} from "./approval-copy";

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

function mapPresence(opts: {
  streaming: boolean;
  acting: boolean;
  awaitingApproval: boolean;
  error: string | null;
  offline: boolean;
}): { state: PresenceState; presentation: PresencePresentation } {
  if (opts.offline) return { state: "OFFLINE", presentation: "offline" };
  if (opts.error && !opts.streaming && !opts.awaitingApproval) {
    return { state: "ERROR", presentation: "error" };
  }
  if (opts.awaitingApproval) {
    return { state: "WAITING_FOR_APPROVAL", presentation: "hold" };
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
  const [approvalQueue, setApprovalQueue] = useState<PendingApproval[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const inFlightTools = useRef(new Set<string>());
  const awaitingApprovalRef = useRef(false);
  const replyRef = useRef("");

  const pendingApproval = approvalQueue[0] ?? null;
  const awaitingApproval = Boolean(pendingApproval);

  useEffect(() => {
    awaitingApprovalRef.current = awaitingApproval;
  }, [awaitingApproval]);

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
    const unsub = window.aurumDesktop.onOverlayShown?.((state) => {
      setPaired(state.paired);
      setOnline(state.online);
      if (!awaitingApprovalRef.current) {
        setError(null);
        if (!state.paired) setStatus("CONNECT");
        else setStatus(state.online ? "READY" : "OFFLINE");
      }
      window.setTimeout(() => inputRef.current?.focus(), 30);
    });
    return () => unsub?.();
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
        inFlightTools.current.clear();
        setStatus("READY");
        return;
      }
      void window.aurumDesktop.hideOverlay();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [streaming]);

  useEffect(() => {
    void window.aurumDesktop.setOverlayExpanded?.(expanded);
  }, [expanded]);

  const presence = mapPresence({
    streaming,
    acting,
    awaitingApproval,
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
        if (event.state === "thinking") setStatus("THINKING");
        if (event.state === "responding") setStatus("RESPONDING");
      }
      return;
    }
    if (event.type === "tool_requested" || event.type === "tool_started") {
      if (awaitingApprovalRef.current) return;
      const key = event.tool ?? "tool";
      inFlightTools.current.add(key);
      setActing(true);
      setStatus((event.display?.label ?? "WORKING").toUpperCase());
      setExpanded(true);
      return;
    }
    if (event.type === "tool_succeeded") {
      const key = event.tool ?? "tool";
      inFlightTools.current.delete(key);
      setActing(inFlightTools.current.size > 0);
      if (!awaitingApprovalRef.current) {
        const label = (event.display?.label ?? "DONE").toUpperCase();
        setStatus(label);
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
      }
      return;
    }
    if (event.type === "tool_failed") {
      const key = event.tool ?? "tool";
      inFlightTools.current.delete(key);
      setActing(inFlightTools.current.size > 0);
      // APPROVAL_REQUIRED is also signaled via approval_required — never ERROR
      if (
        event.error?.code === "APPROVAL_REQUIRED" ||
        awaitingApprovalRef.current
      ) {
        return;
      }
      setError(event.error?.message ?? event.display?.detail ?? "Action failed");
      setStatus("ERROR");
      return;
    }
    if (event.type === "delta" && event.text) {
      setReply((prev) => prev + event.text!);
      setExpanded(true);
      return;
    }
    if (event.type === "done") {
      if (event.message?.content && !replyRef.current) {
        setReply(event.message.content);
      }
      if (event.outcome?.warning && !awaitingApprovalRef.current) {
        setError(event.outcome.warning);
      }
      if (awaitingApprovalRef.current) {
        setStatus("WAITING FOR APPROVAL");
        setActing(false);
        return;
      }
      setSuccessFlash(true);
      window.setTimeout(() => setSuccessFlash(false), 700);
      setStatus("READY");
      return;
    }
    if (event.type === "error") {
      if (awaitingApprovalRef.current) return;
      setError(event.error?.message ?? "Something went wrong");
      setStatus("ERROR");
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
        if (res.code === "EXPIRED" || res.code === "ALREADY_RESOLVED") {
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
    setStreaming(true);
    setActing(false);
    setStatus("THINKING");
    setExpanded(true);
    setApprovalQueue([]);
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
        if (payload.error && !awaitingApprovalRef.current) {
          setError(payload.error);
          setStatus("ERROR");
        } else if (awaitingApprovalRef.current) {
          setStatus("WAITING FOR APPROVAL");
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
      <div className="overlay-shell">
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

  const showBody =
    reply || error || nowPlaying || streaming || pendingApproval;

  return (
    <div className="overlay-shell">
      <div className="overlay-panel">
        <div className="overlay-core">
          <AurumPresence
            state={presence.state}
            size="md"
            presentation={presentation}
          />
        </div>
        <div
          className={`overlay-status${error && !streaming && !awaitingApproval ? " error" : ""}`}
        >
          {error && !streaming && !awaitingApproval
            ? "ERROR"
            : status}
        </div>
        <input
          ref={inputRef}
          className="overlay-command"
          value={command}
          placeholder="What do you need?"
          disabled={streaming || awaitingApproval}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
          }}
        />
        {showBody ? (
          <div className="overlay-body">
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
            {!pendingApproval && reply.length > 280 ? (
              <div className="overlay-actions">
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
        {!streaming && !reply && !error && !pendingApproval ? (
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
