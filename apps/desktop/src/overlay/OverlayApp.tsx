import { useCallback, useEffect, useRef, useState } from "react";
import {
  AurumPresence,
  type PresencePresentation,
  type PresenceState,
} from "@aurum/ui";

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
  display?: { label?: string; detail?: string };
  data?: Record<string, unknown>;
  error?: { message?: string };
  message?: { content?: string };
  outcome?: { usedFallbackResponse?: boolean; warning?: string };
};

function mapPresence(
  streaming: boolean,
  acting: boolean,
  error: string | null,
  offline: boolean,
): { state: PresenceState; presentation: PresencePresentation } {
  if (offline) return { state: "OFFLINE", presentation: "offline" };
  if (error && !streaming) return { state: "ERROR", presentation: "error" };
  if (acting) return { state: "ACTING", presentation: "acting" };
  if (streaming) return { state: "THINKING", presentation: "thinking" };
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
  const abortRef = useRef<(() => void) | null>(null);
  const inFlightTools = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const info = (await window.aurumDesktop.getInfo()) as OverlayInfo;
      setPaired(Boolean(info.paired));
      setOnline(Boolean(info.online));
      if (!info.paired) setStatus("CONNECT");
      else if (!info.online) setStatus("OFFLINE");
      else if (!streaming) setStatus("READY");
    } catch {
      setStatus("READY");
    }
  }, [streaming]);

  useEffect(() => {
    void refresh();
    const unsub = window.aurumDesktop.onOverlayShown?.((state) => {
      setPaired(state.paired);
      setOnline(state.online);
      setError(null);
      if (!state.paired) setStatus("CONNECT");
      else setStatus(state.online ? "READY" : "OFFLINE");
      window.setTimeout(() => inputRef.current?.focus(), 30);
    });
    return () => unsub?.();
  }, [refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (streaming) {
        e.preventDefault();
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

  const presence = mapPresence(
    streaming,
    acting,
    error,
    paired && !online && !streaming,
  );
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

  function applyEvent(event: StreamEvent) {
    if (event.type === "status") {
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
      const label = (event.display?.label ?? "DONE").toUpperCase();
      setStatus(label);
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
            playing: event.tool === "spotify_play_track" || event.tool === "spotify_resume",
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
      if (event.message?.content && !reply) {
        setReply(event.message.content);
      }
      if (event.outcome?.warning) {
        setError(event.outcome.warning);
      }
      setSuccessFlash(true);
      window.setTimeout(() => setSuccessFlash(false), 700);
      setStatus("READY");
      return;
    }
    if (event.type === "error") {
      setError(event.error?.message ?? "Something went wrong");
      setStatus("ERROR");
    }
  }

  async function handleSubmit() {
    const text = command.trim();
    if (!text || streaming) return;
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
        if (payload.error) {
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
            <button type="button" className="overlay-btn" onClick={() => void handlePair()}>
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
        <div className={`overlay-status${error && !streaming ? " error" : ""}`}>
          {error && !streaming ? "ERROR" : status}
        </div>
        <input
          ref={inputRef}
          className="overlay-command"
          value={command}
          placeholder="What do you need?"
          disabled={streaming}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
          }}
        />
        {(reply || error || nowPlaying || streaming) && (
          <div className="overlay-body">
            {reply ? <div className="overlay-reply">{reply}</div> : null}
            {error ? (
              <div className="overlay-reply" style={{ color: "var(--error)" }}>
                {error}
              </div>
            ) : null}
            {nowPlaying ? (
              <div className="overlay-now">
                <div className="overlay-now-title">{nowPlaying.title}</div>
                <div className="overlay-now-sub">
                  {[nowPlaying.artist, nowPlaying.playing === false ? "Paused" : "Playing"]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            ) : null}
            {reply.length > 280 ? (
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
        )}
        {!streaming && !reply && !error ? (
          <div className="overlay-hint">Enter to send · Esc to dismiss</div>
        ) : null}
      </div>
    </div>
  );
}
