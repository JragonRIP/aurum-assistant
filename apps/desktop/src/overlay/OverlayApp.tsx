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
import { normalizeOverlayText } from "./overlay-text";
import {
  overlaySubmitBlockReason,
  shouldAutoSubmitVoiceTranscript,
  type OverlaySubmitRequest,
} from "./overlay-submit";
import { VoiceCaptureSession } from "./voice-capture";
import { getVoicePlayback } from "./voice-playback";
import { StreamingTtsController } from "./streaming-tts";

/** Compact reply threshold — keep in sync with main/overlay-layout.ts */
function shouldOfferShowFull(reply: string): boolean {
  const text = reply.trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/).length;
  return text.length >= 420 || lines >= 10;
}

function isSoftOverlayToolFailure(code?: string, tool?: string): boolean {
  if (
    code === "APPROVAL_REQUIRED" ||
    code === "AMBIGUOUS_TRACK" ||
    code === "AMBIGUOUS_PLAYLIST" ||
    code === "AMBIGUOUS_MATCH" ||
    code === "PLAYBACK_CHANGE_NOT_CONFIRMED" ||
    code === "RATE_LIMITED" ||
    code === "PROVIDER_UNAVAILABLE" ||
    code === "UNSUPPORTED"
  ) {
    return true;
  }
  if (tool?.startsWith("web_")) return true;
  return false;
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
  listening: boolean;
  speaking: boolean;
  transcribing: boolean;
  researching?: boolean;
}): { state: PresenceState; presentation: PresencePresentation } {
  if (opts.offline) return { state: "OFFLINE", presentation: "offline" };
  if (opts.awaitingApproval) {
    return { state: "WAITING_FOR_APPROVAL", presentation: "hold" };
  }
  if (opts.awaitingUser) {
    return { state: "WAITING_FOR_USER", presentation: "awaiting" };
  }
  if (opts.listening) return { state: "LISTENING", presentation: "listening" };
  if (opts.speaking) return { state: "SPEAKING", presentation: "speaking" };
  // Hard errors only — warnings must not enter ERROR while a turn succeeded/degraded
  if (opts.error && !opts.streaming && !opts.transcribing && !opts.acting) {
    return { state: "ERROR", presentation: "error" };
  }
  if (opts.acting || opts.researching) {
    return { state: "ACTING", presentation: "acting" };
  }
  if (opts.streaming || opts.transcribing) {
    return { state: "THINKING", presentation: "thinking" };
  }
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
  const [warning, setWarning] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceOriginRef = useRef(false);
  const captureRef = useRef(new VoiceCaptureSession());
  const playbackRef = useRef(getVoicePlayback());
  const streamingTtsRef = useRef<StreamingTtsController | null>(null);
  const listeningRef = useRef(false);
  const pairedRef = useRef(false);
  const streamingRef = useRef(false);
  const transcribingRef = useRef(false);
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

  function getStreamingTts(): StreamingTtsController {
    if (!streamingTtsRef.current) {
      streamingTtsRef.current = new StreamingTtsController({
        playback: playbackRef.current,
        synthesize: async (opts) => {
          const res = await window.aurumDesktop.voiceSynthesize?.({
            text: opts.text,
            purpose: opts.purpose,
            bypassSpokenMode: opts.bypassSpokenMode,
          });
          return {
            ok: Boolean(res?.ok),
            audioBase64: res?.audioBase64,
            mimeType: res?.mimeType,
            skipped: Boolean((res as { skipped?: boolean } | undefined)?.skipped),
            error: res?.error,
            code: res?.code,
            provider: res?.provider ?? null,
            audioBytes: res?.audioBytes,
            latencyMs: res?.latencyMs,
          };
        },
        log: (stage, fields) => {
          console.info("[aurum:voice:stream]", { stage, ...fields });
          void window.aurumDesktop.voiceLog?.({
            stage,
            fields: fields as Record<
              string,
              string | number | boolean | null
            >,
          });
        },
        onSpeakingChange: (isSpeaking) => {
          setSpeaking(isSpeaking);
          if (isSpeaking) {
            setStatus("SPEAKING");
            setActivitySmooth(defaultPhaseActivity("speaking"));
          } else if (!streamingRef.current) {
            setStatus("READY");
            setActivitySmooth(null);
          }
        },
      });
    }
    return streamingTtsRef.current;
  }

  function cancelStreamingSpeech(): void {
    streamingTtsRef.current?.cancel();
    playbackRef.current.stop();
    setSpeaking(false);
  }
  const writeReply = useCallback((update: string | ((prev: string) => string)) => {
    setReply((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      replyRef.current = next;
      return next;
    });
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

  useEffect(() => {
    pairedRef.current = paired;
  }, [paired]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    transcribingRef.current = transcribing;
  }, [transcribing]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

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
      // Rehydrate from main-owned turn — never abort or wipe a live/completed turn.
      void (async () => {
        try {
          const turn = await window.aurumDesktop.getOverlayTurnState?.();
          if (turn) {
            if (turn.reply) {
              setReply(turn.reply);
              replyRef.current = turn.reply;
              setExpanded(true);
            }
            if (turn.warning) setWarning(turn.warning);
            if (turn.error && turn.status === "FAILED") setError(turn.error);
            if (turn.activity) setActivitySmooth(turn.activity);
            if (turn.status === "RUNNING") {
              setStreaming(true);
              setStatus("WORKING");
            } else if (turn.status === "WAITING_FOR_APPROVAL") {
              setStatus("WAITING");
              if (turn.pendingApproval) {
                setApprovalQueue([turn.pendingApproval]);
              }
            } else if (turn.status === "WAITING_FOR_USER") {
              setAwaitingUser(true);
              setStatus("WAITING");
            } else if (turn.status === "COMPLETED" && turn.reply) {
              setStreaming(false);
              setActing(false);
              setStatus("READY");
            } else if (turn.status === "FAILED" && turn.error) {
              setStreaming(false);
              setStatus("ERROR");
            }
          }
        } catch {
          /* ignore */
        }
        if (!state.paired) setStatus("CONNECT");
        else if (!state.online && !streaming && !awaitingApprovalRef.current) {
          setStatus("OFFLINE");
        }
      })();
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
      // Esc during unsent PTT: cancel recording only
      if (listeningRef.current || captureRef.current.isActive()) {
        captureRef.current.cancel();
        listeningRef.current = false;
        setListening(false);
        setTranscribing(false);
        setActivitySmooth(null);
        setStatus("READY");
        void window.aurumDesktop.voiceCancelPtt?.();
        cancelStreamingSpeech();
        return;
      }
      // Esc while SPEAKING: stop local TTS, then hide — do not cancel agent work
      if (speaking) {
        cancelStreamingSpeech();
      }
      // Esc after submit / while streaming / approval: hide only — execution continues.
      // Esc never approves. Approval stays PENDING until explicit user action.
      void window.aurumDesktop.hideOverlay();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [speaking, setActivitySmooth]);

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
    listening,
    speaking,
    transcribing,
    researching,
  });
  const presentation = successFlash ? "success" : presence.presentation;
  const displayReply = normalizeOverlayText(reply);

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
    void window.aurumDesktop.patchOverlayTurn?.({
      pendingApproval: next,
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
          const playingFromData =
            typeof data.isPlaying === "boolean" ? data.isPlaying : undefined;
          setNowPlaying({
            title,
            artist: artists[0],
            playing: playingFromData,
          });
        }
        if (event.tool === "spotify_pause") {
          const playingFromData =
            typeof data.isPlaying === "boolean" ? data.isPlaying : false;
          setNowPlaying((prev) =>
            prev ? { ...prev, playing: playingFromData } : prev,
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
      // Soft tool failures (research unavailable, clarifications, etc.) — never ERROR
      if (
        isSoftOverlayToolFailure(event.error?.code, event.tool) ||
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
            writeReply(event.error.message);
            setExpanded(true);
          }
        } else if (
          event.error?.code === "PLAYBACK_CHANGE_NOT_CONFIRMED" ||
          event.error?.code === "RATE_LIMITED"
        ) {
          setError(null);
          setActivitySmooth(null);
          if (event.error?.message) {
            writeReply(event.error.message);
            setExpanded(true);
          }
        } else if (
          event.error?.code === "PROVIDER_UNAVAILABLE" ||
          event.tool?.startsWith("web_")
        ) {
          setError(null);
          setWarning(
            event.error?.message ??
              event.display?.detail ??
              "Couldn't reach web search.",
          );
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
      writeReply(detail);
      setExpanded(true);
      return;
    }
    if (event.type === "delta" && event.text) {
      setActivitySmooth(null);
      writeReply((prev) => prev + event.text!);
      setExpanded(true);
      if (voiceOriginRef.current) {
        getStreamingTts().onDelta(event.text!);
      }
      return;
    }
    if (event.type === "done") {
      setActivitySmooth(null);
      if (event.message?.content) {
        // Prefer final message content when present; always sync replyRef now.
        if (!replyRef.current.trim()) {
          writeReply(event.message.content);
        } else if (event.message.content.length > replyRef.current.length) {
          writeReply(event.message.content);
        }
      }
      if (
        event.outcome?.warning &&
        !awaitingApprovalRef.current &&
        !awaitingUserRef.current
      ) {
        // Degraded success — warning, not ERROR presence
        setWarning(event.outcome.warning);
        setError(null);
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
      if (remainingAfter === 0) {
        void window.aurumDesktop.patchOverlayTurn?.({
          pendingApproval: null,
        });
      }

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

  async function submitOverlayRequest(opts: OverlaySubmitRequest) {
    const text = opts.text.trim();
    const block = overlaySubmitBlockReason({
      text,
      paired: pairedRef.current,
      streaming: streamingRef.current,
      awaitingApproval: awaitingApprovalRef.current,
      listening: listeningRef.current,
      transcribing: transcribingRef.current,
    });
    if (block === "empty" || block === "busy") return;
    if (block === "unpaired") {
      setStatus("CONNECT");
      return;
    }

    voiceOriginRef.current = opts.origin === "voice";
    cancelStreamingSpeech();
    setCommand("");
    writeReply("");
    setError(null);
    setWarning(null);
    setAwaitingUser(false);
    streamingRef.current = true;
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

    if (opts.origin === "voice") {
      getStreamingTts().beginTurn();
    }

    const handle = await window.aurumDesktop.startOverlayChat(text, {
      origin: opts.origin,
    });
    abortRef.current = () => {
      void window.aurumDesktop.cancelOverlayChat?.(handle.id);
    };

    let streamSpeechStarted = opts.origin === "voice";
    const unsub = window.aurumDesktop.onOverlayChatEvent?.((payload) => {
      if (payload.id !== handle.id) return;
      if (payload.event) applyEvent(payload.event as StreamEvent);
      if (payload.done || payload.error) {
        streamingRef.current = false;
        setStreaming(false);
        setActing(false);
        inFlightTools.current.clear();
        setResearching(false);
        setActivitySmooth(null);
        if (awaitingApprovalRef.current) {
          setStatus("WAITING FOR APPROVAL");
          if (voiceOriginRef.current) {
            cancelStreamingSpeech();
            void speakApprovalPrompt();
          }
        } else if (awaitingUserRef.current) {
          setStatus("NEED YOUR INPUT");
          setError(null);
          cancelStreamingSpeech();
        } else if (payload.error) {
          setError(payload.error);
          setStatus("ERROR");
          cancelStreamingSpeech();
        } else {
          setStatus("READY");
          const speech = replyRef.current.trim();
          console.info("[aurum:voice:tts]", {
            stage: "turn_complete",
            origin: voiceOriginRef.current ? "voice" : "text",
            finalResponseLen: speech.length,
            streamSpeechStarted,
          });
          if (voiceOriginRef.current && streamSpeechStarted) {
            getStreamingTts().onAgentComplete();
            streamSpeechStarted = false;
          }
        }
        unsub?.();
        abortRef.current = null;
        window.setTimeout(() => inputRef.current?.focus(), 40);
      }
    });
  }

  const submitOverlayRequestRef = useRef(submitOverlayRequest);
  submitOverlayRequestRef.current = submitOverlayRequest;

  async function handleSubmit() {
    await submitOverlayRequest({
      text: command,
      origin: "text",
    });
  }

  async function speakApprovalPrompt() {
    try {
      const res = await window.aurumDesktop.voiceSynthesize?.({
        text: "I need your approval.",
      });
      if (!res?.ok || !res.audioBase64) return;
      setSpeaking(true);
      setStatus("SPEAKING");
      await playbackRef.current.playBase64(res.audioBase64, res.mimeType || "audio/wav", {
        onEnded: () => {
          setSpeaking(false);
          setStatus("WAITING FOR APPROVAL");
        },
      });
    } catch {
      // non-blocking
    }
  }

  async function speakFinalReply(text: string) {
    const origin = voiceOriginRef.current ? "voice" : "text";
    const finalReplyLen = text.trim().length;
    const finalTextAt = Date.now();
    const log = (stage: string, fields?: Record<string, string | number | boolean | null>) => {
      console.info("[aurum:voice:tts]", { stage, ...fields });
      void window.aurumDesktop.voiceLog?.({ stage, fields });
    };

    log("eligibility", {
      voice_origin: origin === "voice",
      final_reply_length: finalReplyLen,
      eligible: origin === "voice" && finalReplyLen > 0,
    });
    if (origin !== "voice" || !text.trim()) return;

    try {
      log("synth_request_started", {
        synth_request_started: true,
        speech_text_length: finalReplyLen,
      });
      const res = await window.aurumDesktop.voiceSynthesize?.({
        text,
        debugDumpWav: true,
        purpose: "ptt_final",
      });
      log("synth_status", {
        synth_status: res?.httpStatus ?? (res?.ok ? 200 : 0),
        skipped: Boolean((res as { skipped?: boolean } | undefined)?.skipped),
        code: res?.code ?? null,
        spoken_mode: res?.spokenMode ?? null,
        voice_enabled: res?.voiceEnabled ?? null,
        speech_text_length: (res?.speechText ?? "").length,
        audio_bytes: res?.audioBytes ?? 0,
        audio_mime: (res?.mimeType ?? "").split(";")[0] || null,
        wav_ok: res?.wavInfo?.ok ?? null,
        wav_rate: res?.wavInfo?.sampleRate ?? null,
        wav_channels: res?.wavInfo?.numChannels ?? null,
        wav_bits: res?.wavInfo?.bitsPerSample ?? null,
        debug_wav: res?.debugWavPath ?? null,
        provider: res?.provider ?? null,
        cloud_tts_called: res?.provider === "gemini",
      });
      if (!res?.ok || !res.audioBase64) {
        if (
          res?.error &&
          res.code !== "tts_disabled" &&
          !(res as { skipped?: boolean }).skipped
        ) {
          setActivitySmooth("Voice playback unavailable.");
          window.setTimeout(() => setActivitySmooth(null), 2200);
        }
        return;
      }
      setSpeaking(true);
      setStatus("SPEAKING");
      setActivitySmooth(defaultPhaseActivity("speaking"));
      log("speaking_entered", { speaking_entered: true });
      void window.aurumDesktop.voiceLog?.({
        stage: "play_requested",
        fields: {
          channel: "VOICE_PLAYBACK",
          provider: res.provider ?? null,
          audio_bytes: res.audioBytes ?? 0,
          final_text_to_play_request_ms: Date.now() - finalTextAt,
        },
      });
      const played = await playbackRef.current.playBase64(
        res.audioBase64,
        res.mimeType || "audio/wav",
        {
          onEvent: (event, fields) => {
            log(`audio_${event}`, {
              event,
              ...(fields ?? {}),
            });
            if (event === "playing" || event === "play_resolved") {
              void window.aurumDesktop.voiceLog?.({
                stage: event === "playing" ? "playing" : "play_resolved",
                fields: {
                  channel: "VOICE_PLAYBACK",
                  final_text_to_playback_start_ms: Date.now() - finalTextAt,
                  ...(fields ?? {}),
                },
              });
            }
            if (event === "ended") {
              void window.aurumDesktop.voiceLog?.({
                stage: "ended",
                fields: { channel: "VOICE_PLAYBACK" },
              });
            }
          },
          onEnded: () => {
            log("ended", { speaking_entered: false, event: "ended" });
            setSpeaking(false);
            setActivitySmooth(null);
            setStatus("READY");
          },
          onError: (message) => {
            log("error", {
              speaking_entered: false,
              event: "error",
              play_error_message: message.slice(0, 120),
            });
            setSpeaking(false);
            setStatus("READY");
            setActivitySmooth("Voice playback unavailable.");
            window.setTimeout(() => setActivitySmooth(null), 2200);
          },
        },
      );
      log("playback", {
        playback_attempted: played.diag.playbackAttempted,
        play_promise_resolved: played.diag.playPromiseResolved,
        play_error_name: played.diag.playErrorName ?? null,
        play_error_message: played.diag.playErrorMessage ?? null,
        audio_volume: played.diag.audioVolume ?? null,
        audio_muted: played.diag.audioMuted ?? null,
        audio_bytes: played.diag.audioBytes ?? null,
        blob_bytes: played.diag.blobBytes ?? null,
        blob_mime: played.diag.blobMime ?? null,
        object_url_created: played.diag.objectUrlCreated ?? null,
        ready_state: played.diag.readyState ?? null,
        network_state: played.diag.networkState ?? null,
        events: played.diag.events ?? null,
      });
      if (!played.ok) {
        setSpeaking(false);
        setStatus("READY");
        setActivitySmooth("Voice playback unavailable.");
        window.setTimeout(() => setActivitySmooth(null), 2200);
      }
    } catch (err) {
      log("synthesize_exception", {
        play_error_message:
          err instanceof Error ? err.message.slice(0, 120) : "unknown",
      });
      setSpeaking(false);
      setActivitySmooth("Voice playback unavailable.");
      window.setTimeout(() => setActivitySmooth(null), 2200);
    }
  }

  useEffect(() => {
    const unsub = window.aurumDesktop.onVoiceTestPlay?.(async (payload) => {
      const purpose = payload.purpose || "test_voice";
      const log = (
        stage: string,
        fields?: Record<string, string | number | boolean | null>,
      ) => {
        console.info("[aurum:voice:tts]", { stage, purpose, ...fields });
        void window.aurumDesktop.voiceLog?.({
          stage,
          fields: { purpose, ...(fields ?? {}) },
        });
      };
      log("test_voice_overlay_play", {
        playback_attempted: true,
        audio_mime: (payload.mimeType || "").split(";")[0] || null,
        audio_bytes_b64_len: payload.audioBase64?.length ?? 0,
      });
      setSpeaking(true);
      setStatus("SPEAKING");
      setActivitySmooth(defaultPhaseActivity("speaking"));
      log("speaking_entered", { speaking_entered: true });
      try {
        const played = await playbackRef.current.playBase64(
          payload.audioBase64,
          payload.mimeType || "audio/wav",
          {
            onEvent: (event, fields) => {
              log(`audio_${event}`, { event, ...(fields ?? {}) });
            },
            onEnded: () => {
              log("ended", { event: "ended" });
              setSpeaking(false);
              setActivitySmooth(null);
              setStatus("READY");
            },
            onError: (message) => {
              log("error", {
                event: "error",
                play_error_message: message.slice(0, 120),
              });
              setSpeaking(false);
              setStatus("READY");
              setActivitySmooth("Voice playback unavailable.");
              window.setTimeout(() => setActivitySmooth(null), 2200);
            },
          },
        );
        log("playback", {
          playback_attempted: played.diag.playbackAttempted,
          play_promise_resolved: played.diag.playPromiseResolved,
          play_error_name: played.diag.playErrorName ?? null,
          play_error_message: played.diag.playErrorMessage ?? null,
          audio_volume: played.diag.audioVolume ?? null,
          audio_muted: played.diag.audioMuted ?? null,
          audio_bytes: played.diag.audioBytes ?? null,
          blob_bytes: played.diag.blobBytes ?? null,
          blob_mime: played.diag.blobMime ?? null,
          object_url_created: played.diag.objectUrlCreated ?? null,
          ready_state: played.diag.readyState ?? null,
          network_state: played.diag.networkState ?? null,
          events: played.diag.events ?? null,
        });
        window.aurumDesktop.voiceTestPlayResult?.({
          ok: played.ok,
          playPromiseResolved: played.diag.playPromiseResolved,
          playErrorName: played.diag.playErrorName ?? null,
          playErrorMessage: played.diag.playErrorMessage ?? null,
          audioVolume: played.diag.audioVolume ?? null,
          audioMuted: played.diag.audioMuted ?? null,
          speakingEntered: true,
          events: played.diag.events ?? null,
          objectUrlCreated: played.diag.objectUrlCreated ?? false,
        });
        if (!played.ok) {
          setSpeaking(false);
          setStatus("READY");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message.slice(0, 120) : "unknown";
        log("synthesize_exception", {
          play_error_message: message,
        });
        window.aurumDesktop.voiceTestPlayResult?.({
          ok: false,
          playPromiseResolved: false,
          playErrorMessage: message,
          speakingEntered: false,
        });
        setSpeaking(false);
        setStatus("READY");
      }
    });
    return () => unsub?.();
  }, [setActivitySmooth]);

  useEffect(() => {
    const unsubPtt = window.aurumDesktop.onVoicePtt?.(async (payload) => {
      if (payload.phase === "cancel") {
        captureRef.current.cancel();
        listeningRef.current = false;
        setListening(false);
        transcribingRef.current = false;
        setTranscribing(false);
        setActivitySmooth(null);
        setStatus("READY");
        return;
      }
      if (payload.phase === "start") {
        // Barge-in: stop speech + clear queued sentence audio
        const wasSpeaking =
          playbackRef.current.isPlaying() || playbackRef.current.queueLength() > 0;
        cancelStreamingSpeech();
        if (wasSpeaking) {
          void window.aurumDesktop.voiceLog?.({
            stage: "barge_in",
            fields: {
              channel: "VOICE_PTT",
              playback_stopped: true,
              queue_cleared: true,
            },
          });
        }
        if (streamingRef.current || awaitingApprovalRef.current) return;
        const started = await captureRef.current.start();
        if (!started.ok) {
          setError(
            /permission|NotAllowed|denied/i.test(started.error ?? "")
              ? "Microphone permission denied."
              : started.error ?? "Microphone unavailable.",
          );
          setStatus("ERROR");
          return;
        }
        listeningRef.current = true;
        setListening(true);
        setError(null);
        setExpanded(true);
        setStatus("LISTENING");
        setActivitySmooth(defaultPhaseActivity("listening"));
        return;
      }
      if (payload.phase === "stop") {
        if (!listeningRef.current && !captureRef.current.isActive()) return;
        listeningRef.current = false;
        setListening(false);
        transcribingRef.current = true;
        setTranscribing(true);
        setStatus("TRANSCRIBING");
        setActivitySmooth(defaultPhaseActivity("transcribing"));
        const stopped = await captureRef.current.stop();
        if (!stopped.ok) {
          transcribingRef.current = false;
          setTranscribing(false);
          setActivitySmooth(null);
          setStatus("READY");
          if (stopped.code !== "cancelled") {
            writeReply(stopped.message);
            setExpanded(true);
          }
          return;
        }
        try {
          console.info("[aurum:voice:overlay]", {
            event: "submit",
            durationMs: stopped.durationMs,
            blobBytes: stopped.blob.size,
            mimeType: stopped.mimeType,
            chunkCount: stopped.chunkCount,
            requestedMimeType: stopped.requestedMimeType,
          });
          const ab = await stopped.blob.arrayBuffer();
          const bytes = new Uint8Array(ab);
          const res = await window.aurumDesktop.voiceTranscribe?.({
            bytes,
            mimeType: stopped.mimeType,
          });
          // Clear transcribing BEFORE canonical submit so gate refs allow the turn.
          transcribingRef.current = false;
          setTranscribing(false);
          setActivitySmooth(null);
          const transcript = res?.transcript?.trim() ?? "";
          void window.aurumDesktop.voiceLog?.({
            stage: "transcription_complete",
            fields: {
              channel: "VOICE_PTT",
              ok: Boolean(res?.ok),
              transcript_length: transcript.length,
            },
          });
          if (!res?.ok || !shouldAutoSubmitVoiceTranscript(transcript)) {
            writeReply(res?.error || "I didn't catch that.");
            setExpanded(true);
            setStatus("READY");
            return;
          }
          // Brief visual context, then immediately auto-submit via the same pipeline.
          setCommand(transcript);
          await submitOverlayRequestRef.current({
            text: transcript,
            origin: "voice",
          });
        } catch {
          transcribingRef.current = false;
          setTranscribing(false);
          setActivitySmooth(null);
          writeReply("Transcription unavailable.");
          setStatus("READY");
        }
      }
    });
    const unsubFocus = window.aurumDesktop.onOverlayFocusInput?.(() => {
      window.setTimeout(() => inputRef.current?.focus(), 40);
    });
    return () => {
      unsubPtt?.();
      unsubFocus?.();
    };
  }, [setActivitySmooth]);

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
    listening,
    speaking,
    transcribing,
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
          error: Boolean(error) && !streaming && !awaitingApproval && !awaitingUser && !listening,
          researching,
          acting,
          streaming,
          hasReply: Boolean(reply),
          listening,
          transcribing,
          speaking,
        });

  const showBody =
    reply ||
    error ||
    nowPlaying ||
    streaming ||
    pendingApproval ||
    sources.length > 0 ||
    Boolean(activityLine) ||
    listening;
  const offerShowFull = shouldOfferShowFull(reply);
  const layoutClass = !expanded
    ? "layout-idle"
    : layoutFull
      ? "layout-full"
      : "layout-compact";
  const inputSecondary =
    streaming ||
    acting ||
    awaitingApproval ||
    awaitingUser ||
    listening ||
    transcribing ||
    speaking;

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
            error && !streaming && !awaitingApproval && !awaitingUser && !listening
              ? " error"
              : ""
          }`}
        >
          {listening ? (
            <span className="overlay-mic-live" aria-label="Microphone active">
              ●{" "}
            </span>
          ) : null}
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
          disabled={streaming || awaitingApproval || listening || transcribing}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (listening || transcribing) {
              if (e.key === " " || e.code === "Space") e.preventDefault();
              return;
            }
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
            {!pendingApproval && displayReply ? (
              <div className="overlay-reply">{displayReply}</div>
            ) : null}
            {warning && !error ? (
              <div className="overlay-reply overlay-warning">{warning}</div>
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
                    nowPlaying.playing === false
                      ? "Paused"
                      : nowPlaying.playing === true
                        ? "Playing"
                        : null,
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
