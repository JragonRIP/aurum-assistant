/**
 * Streaming PTT TTS: sentence flush → serial Kokoro → ordered VoicePlayback queue.
 * One logical turn ID; barge-in cancels synth + queue.
 *
 * DOM-free module — safe to import from Electron main for validation.
 */
import type { SpokenOrigin, SpokenToolHint } from "@aurum/ai";
import {
  isSpeakableChunk,
  pullCompleteSentences,
} from "./speech-chunker";

export type StreamingLatencyMarks = {
  agent_first_token?: number;
  agent_first_sentence_ready?: number;
  agent_complete?: number;
  speech_text_ready?: number;
  kokoro_request_start?: number;
  kokoro_audio_ready?: number;
  playback_requested?: number;
  playback_playing?: number;
};

export type StreamingTtsLog = (
  stage: string,
  fields?: Record<string, string | number | boolean | null | undefined>,
) => void;

export type SynthesizeFn = (opts: {
  text: string;
  purpose: string;
  bypassSpokenMode: boolean;
  alreadyPrepared?: boolean;
  skipAddress?: boolean;
  addressAlreadyUsed?: boolean;
  skipSimplification?: boolean;
  origin?: SpokenOrigin;
  userMessage?: string;
  toolHints?: SpokenToolHint[];
  signal?: AbortSignal;
}) => Promise<{
  ok: boolean;
  audioBase64?: string;
  mimeType?: string;
  skipped?: boolean;
  error?: string;
  code?: string;
  provider?: string | null;
  audioBytes?: number;
  latencyMs?: number;
  speechText?: string;
  addressApplied?: boolean;
}>;

/** Minimal playback surface (implemented by VoicePlayback in the overlay). */
export type StreamingPlaybackSink = {
  beginTurn(turnId: number): void;
  stop(): void;
  enqueueBase64(
    audioBase64: string,
    mimeType: string,
    opts: {
      turnId: number;
      chunkIndex: number;
      onEvent?: (
        event: string,
        fields?: Record<string, string | number | boolean | null>,
      ) => void;
      onEnded?: () => void;
      onError?: (message: string) => void;
      onQueueIdle?: () => void;
    },
  ): void;
};

type PendingSynth = {
  turnId: number;
  chunkIndex: number;
  raw: string;
  kind: "ack" | "final";
  skipAddress: boolean;
  skipSimplification: boolean;
  origin: SpokenOrigin;
};

export class StreamingTtsController {
  private turnId = 0;
  private buffer = "";
  private chunkIndex = 0;
  private pendingSynth: PendingSynth[] = [];
  private synthActive = false;
  private abort: AbortController | null = null;
  private active = false;
  private marks: StreamingLatencyMarks = {};
  private firstSentenceLogged = false;
  private addressAlreadyUsed = false;
  private ackEnqueued = false;
  private userMessage = "";
  private toolHints: SpokenToolHint[] = [];
  private playback: StreamingPlaybackSink;
  private synthesize: SynthesizeFn;
  private log: StreamingTtsLog;
  private onSpeakingChange?: (speaking: boolean) => void;

  constructor(opts: {
    synthesize: SynthesizeFn;
    playback: StreamingPlaybackSink;
    log?: StreamingTtsLog;
    onSpeakingChange?: (speaking: boolean) => void;
  }) {
    this.synthesize = opts.synthesize;
    this.log = opts.log ?? (() => undefined);
    this.playback = opts.playback;
    this.onSpeakingChange = opts.onSpeakingChange;
  }

  getTurnId(): number {
    return this.turnId;
  }

  getMarks(): StreamingLatencyMarks {
    return { ...this.marks };
  }

  /** Start a voice-origin speak turn (cancels prior). */
  beginTurn(opts?: { userMessage?: string }): number {
    this.cancel();
    this.turnId += 1;
    this.active = true;
    this.buffer = "";
    this.chunkIndex = 0;
    this.pendingSynth = [];
    this.synthActive = false;
    this.marks = {};
    this.firstSentenceLogged = false;
    this.addressAlreadyUsed = false;
    this.ackEnqueued = false;
    this.userMessage = opts?.userMessage ?? "";
    this.toolHints = [];
    this.abort = new AbortController();
    this.playback.beginTurn(this.turnId);
    this.log("stream_turn_begin", {
      channel: "VOICE_PTT",
      turn_id: this.turnId,
    });
    return this.turnId;
  }

  addressWasUsed(): boolean {
    return this.addressAlreadyUsed;
  }

  addToolHint(hint: SpokenToolHint): void {
    this.toolHints.push(hint);
  }

  /**
   * Pre-action acknowledgement — starts TTS immediately, never blocks tools.
   * One ack per turn. Skipped if final speech already started.
   */
  enqueueAcknowledgement(text: string): boolean {
    const raw = text.trim();
    if (!this.active || !raw || this.ackEnqueued) return false;
    if (this.chunkIndex > 0 || this.synthActive) return false;
    const applyAddress = !this.addressAlreadyUsed;
    if (applyAddress) this.addressAlreadyUsed = true;
    this.ackEnqueued = true;
    const chunkIndex = this.chunkIndex;
    this.chunkIndex += 1;
    this.pendingSynth.unshift({
      turnId: this.turnId,
      chunkIndex,
      raw,
      kind: "ack",
      skipAddress: !applyAddress,
      skipSimplification: true,
      origin: "ack",
    });
    this.log("ack_enqueued", {
      channel: "VOICE_PTT",
      turn_id: this.turnId,
      chunk_index: chunkIndex,
      ack_blocks_tools: false,
      address_applied: applyAddress,
    });
    void this.pumpSynth();
    return true;
  }

  /** Barge-in / new PTT / Esc — drop everything. */
  cancel(): void {
    const tid = this.turnId;
    this.active = false;
    this.buffer = "";
    this.pendingSynth = [];
    this.synthActive = false;
    this.addressAlreadyUsed = false;
    this.ackEnqueued = false;
    this.toolHints = [];
    try {
      this.abort?.abort();
    } catch {
      /* ignore */
    }
    this.abort = null;
    this.playback.stop();
    this.onSpeakingChange?.(false);
    if (tid > 0) {
      this.log("stream_turn_cancel", {
        channel: "VOICE_PTT",
        turn_id: tid,
      });
    }
  }

  onDelta(text: string): void {
    if (!this.active || !text) return;
    const now = Date.now();
    if (this.marks.agent_first_token == null) {
      this.marks.agent_first_token = now;
      this.log("agent_first_token", {
        channel: "VOICE_PTT",
        turn_id: this.turnId,
        t: now,
      });
    }
    this.buffer += text;
    this.flushBuffer(false);
  }

  /** Agent stream finished — flush trailing fragment. */
  onAgentComplete(): void {
    if (!this.active) return;
    const now = Date.now();
    this.marks.agent_complete = now;
    this.log("agent_complete", {
      channel: "VOICE_PTT",
      turn_id: this.turnId,
      t: now,
      buffer_remaining: this.buffer.trim().length,
    });
    this.flushBuffer(true);
  }

  private flushBuffer(force: boolean): void {
    const { sentences, remainder } = pullCompleteSentences(this.buffer, {
      flush: force,
      softFlushMinChars: 140,
    });
    this.buffer = remainder;
    const lastIndex = sentences.length - 1;
    for (let i = 0; i < sentences.length; i += 1) {
      const raw = sentences[i]!;
      if (!isSpeakableChunk(raw)) continue;
      const lastOfTurn = force && i === lastIndex && !this.buffer.trim();
      const firstShort =
        this.chunkIndex === 0 &&
        raw.trim().length <= 160 &&
        !this.addressAlreadyUsed;
      const applyAddress = !this.addressAlreadyUsed && (firstShort || lastOfTurn);
      if (applyAddress) this.addressAlreadyUsed = true;
      const now = Date.now();
      if (this.marks.agent_first_sentence_ready == null) {
        this.marks.agent_first_sentence_ready = now;
        this.marks.speech_text_ready = now;
        this.firstSentenceLogged = true;
        this.log("agent_first_sentence_ready", {
          channel: "VOICE_PTT",
          turn_id: this.turnId,
          t: now,
          speech_text_length: raw.trim().length,
        });
      } else if (!this.firstSentenceLogged) {
        this.firstSentenceLogged = true;
      }
      this.log("speech_text_ready", {
        channel: "VOICE_TTS",
        turn_id: this.turnId,
        chunk_index: this.chunkIndex,
        speech_text_length: raw.trim().length,
        skip_address: !applyAddress,
        t: now,
      });
      this.pendingSynth.push({
        turnId: this.turnId,
        chunkIndex: this.chunkIndex,
        raw,
        kind: "final",
        skipAddress: !applyAddress,
        skipSimplification: false,
        origin: "stream",
      });
      this.chunkIndex += 1;
    }
    void this.pumpSynth();
  }

  private async pumpSynth(): Promise<void> {
    if (this.synthActive) return;
    const next = this.pendingSynth.shift();
    if (!next) return;
    if (next.turnId !== this.turnId || !this.active) return;

    this.synthActive = true;
    const reqAt = Date.now();
    if (this.marks.kokoro_request_start == null) {
      this.marks.kokoro_request_start = reqAt;
    }
    this.log("kokoro_request_start", {
      channel: "VOICE_LOCAL",
      turn_id: next.turnId,
      chunk_index: next.chunkIndex,
      speech_text_length: next.raw.trim().length,
      kind: next.kind,
      t: reqAt,
    });

    try {
      const res = await this.synthesize({
        text: next.raw,
        purpose:
          next.kind === "ack"
            ? "ptt_ack"
            : next.chunkIndex === 0
              ? "ptt_sentence_first"
              : "ptt_sentence",
        // Voice-origin PTT: skip cloud previewOnly gate (was a multi-second tax).
        bypassSpokenMode: true,
        alreadyPrepared: false,
        skipAddress: next.skipAddress,
        addressAlreadyUsed: next.skipAddress,
        skipSimplification: next.skipSimplification,
        origin: next.origin,
        userMessage: this.userMessage,
        toolHints: this.toolHints,
        signal: this.abort?.signal,
      });

      if (next.turnId !== this.turnId || !this.active) {
        return;
      }

      const readyAt = Date.now();
      if (this.marks.kokoro_audio_ready == null) {
        this.marks.kokoro_audio_ready = readyAt;
      }
      this.log("kokoro_audio_ready", {
        channel: "VOICE_LOCAL",
        turn_id: next.turnId,
        chunk_index: next.chunkIndex,
        ok: res.ok,
        provider: res.provider ?? null,
        audio_bytes: res.audioBytes ?? 0,
        latency_ms: res.latencyMs ?? readyAt - reqAt,
        t: readyAt,
        delta_speech_to_audio_ms:
          this.marks.speech_text_ready != null
            ? readyAt - this.marks.speech_text_ready
            : null,
      });

      if (!res.ok || !res.audioBase64 || res.skipped) {
        this.log("kokoro_chunk_skip", {
          channel: "VOICE_TTS",
          turn_id: next.turnId,
          chunk_index: next.chunkIndex,
          code: res.code ?? null,
        });
        return;
      }

      const playReqAt = Date.now();
      if (this.marks.playback_requested == null) {
        this.marks.playback_requested = playReqAt;
      }
      this.log("playback_requested", {
        channel: "VOICE_PLAYBACK",
        turn_id: next.turnId,
        chunk_index: next.chunkIndex,
        audio_bytes: res.audioBytes ?? 0,
        t: playReqAt,
      });

      this.onSpeakingChange?.(true);
      this.playback.enqueueBase64(res.audioBase64, res.mimeType || "audio/wav", {
        turnId: next.turnId,
        chunkIndex: next.chunkIndex,
        onEvent: (event, fields) => {
          if (event === "playing" || event === "play_resolved") {
            if (this.marks.playback_playing == null) {
              this.marks.playback_playing = Date.now();
              this.logLatencyDeltas();
            }
            this.log("playback_playing", {
              channel: "VOICE_PLAYBACK",
              turn_id: next.turnId,
              chunk_index: next.chunkIndex,
              event,
              t: Date.now(),
              ...(fields ?? {}),
            });
          }
          if (event === "ended") {
            this.log("playback_chunk_ended", {
              channel: "VOICE_PLAYBACK",
              turn_id: next.turnId,
              chunk_index: next.chunkIndex,
            });
          }
        },
        onQueueIdle: () => {
          this.onSpeakingChange?.(false);
          this.log("playback_queue_idle", {
            channel: "VOICE_PLAYBACK",
            turn_id: this.turnId,
          });
        },
      });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      this.log("kokoro_chunk_error", {
        channel: "VOICE_LOCAL",
        turn_id: next.turnId,
        chunk_index: next.chunkIndex,
        error:
          err instanceof Error ? err.message.slice(0, 120) : "synth_failed",
      });
    } finally {
      this.synthActive = false;
      // Prefetch next sentence while current audio plays.
      void this.pumpSynth();
    }
  }

  private logLatencyDeltas(): void {
    const m = this.marks;
    const playing = m.playback_playing;
    if (playing == null) return;
    this.log("latency_deltas", {
      channel: "VOICE_PTT",
      turn_id: this.turnId,
      A_first_sentence_to_playing_ms:
        m.agent_first_sentence_ready != null
          ? playing - m.agent_first_sentence_ready
          : null,
      B_agent_complete_to_playing_ms:
        m.agent_complete != null ? playing - m.agent_complete : null,
      C_speech_text_to_kokoro_audio_ms:
        m.speech_text_ready != null && m.kokoro_audio_ready != null
          ? m.kokoro_audio_ready - m.speech_text_ready
          : null,
      D_kokoro_audio_to_playing_ms:
        m.kokoro_audio_ready != null
          ? playing - m.kokoro_audio_ready
          : null,
      // Negative B means speech started before agent_complete (streaming win).
      streamed_before_complete:
        m.agent_complete != null &&
        m.playback_playing != null &&
        m.playback_playing < m.agent_complete,
    });
  }
}
