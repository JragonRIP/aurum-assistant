import os from "node:os";
import type { DeviceCredential } from "./credentials";
import type { ApprovedRoot } from "./windows-tools";
import { executeDesktopTool } from "./windows-tools";

export type BridgeState = {
  online: boolean;
  approvedRoots: ApprovedRoot[];
  lastError?: string;
};

export class DeviceBridge {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = false;
  state: BridgeState = { online: false, approvedRoots: [] };

  constructor(
    private cred: DeviceCredential,
    private onLog?: (msg: string, extra?: Record<string, unknown>) => void,
  ) {}

  start(): void {
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 12_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state.online = false;
  }

  private authHeader(): string {
    return `Bearer ${this.cred.deviceId}.${this.cred.deviceSecret}`;
  }

  private url(p: string): string {
    return `${this.cred.webUrl.replace(/\/$/, "")}${p}`;
  }

  async refresh(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const res = await fetch(this.url("/api/devices/bridge/heartbeat"), {
        method: "POST",
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appVersion: "0.4.0",
          osVersion: os.release(),
        }),
      });
      if (!res.ok) {
        this.state.online = false;
        this.state.lastError = `heartbeat ${res.status}`;
        this.onLog?.("heartbeat_failed", { status: res.status });
        return;
      }
      const data = (await res.json()) as {
        approvedRoots?: ApprovedRoot[];
      };
      this.state.online = true;
      this.state.approvedRoots = data.approvedRoots ?? [];
      this.state.lastError = undefined;
    } catch (err) {
      this.state.online = false;
      this.state.lastError = "heartbeat network error";
      this.onLog?.("heartbeat_error", {
        error: err instanceof Error ? err.message : "unknown",
      });
      return;
    }

    if (!this.polling) {
      void this.pollLoop();
    }
  }

  private async pollLoop(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      while (!this.stopped && this.state.online) {
        const res = await fetch(
          this.url("/api/devices/bridge/poll?wait=20000"),
          {
            headers: { Authorization: this.authHeader() },
          },
        );
        if (!res.ok) {
          this.onLog?.("poll_failed", { status: res.status });
          break;
        }
        const data = (await res.json()) as {
          request: null | {
            requestId: string;
            tool: string;
            executionId: string;
            payload: Record<string, unknown>;
            expiresAt: string;
          };
        };
        if (!data.request) continue;

        if (Date.parse(data.request.expiresAt) < Date.now()) {
          await this.postResult({
            requestId: data.request.requestId,
            executionId: data.request.executionId,
            success: false,
            error: {
              code: "REQUEST_EXPIRED",
              message: "Device request expired.",
            },
          });
          continue;
        }

        const t0 = Date.now();
        this.onLog?.("tool_start", {
          tool: data.request.tool,
          executionId: data.request.executionId,
        });

        const result = await executeDesktopTool({
          tool: data.request.tool,
          payload: data.request.payload,
          approvedRoots: this.state.approvedRoots,
          executionId: data.request.executionId,
        });

        this.onLog?.("tool_done", {
          tool: data.request.tool,
          success: result.success,
          durationMs: Date.now() - t0,
        });

        await this.postResult({
          requestId: data.request.requestId,
          executionId: data.request.executionId,
          success: result.success,
          data: result.data,
          error: result.error,
          completedAt: new Date().toISOString(),
        });
      }
    } finally {
      this.polling = false;
    }
  }

  private async postResult(body: {
    requestId: string;
    executionId: string;
    success: boolean;
    data?: unknown;
    error?: { code: string; message: string };
    completedAt?: string;
  }): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(this.url("/api/devices/bridge/result"), {
          method: "POST",
          headers: {
            Authorization: this.authHeader(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return;
        this.onLog?.("result_post_failed", {
          status: res.status,
          attempt,
          executionId: body.executionId,
        });
      } catch (err) {
        this.onLog?.("result_post_error", {
          attempt,
          executionId: body.executionId,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }

  async pair(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(this.url("/api/devices/pair"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          deviceName: os.hostname(),
          platform: process.platform,
          osVersion: os.release(),
          appVersion: "0.4.0",
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        deviceId?: string;
        deviceSecret?: string;
        deviceName?: string;
        webUrl?: string;
      };
      if (!res.ok || !data.deviceId || !data.deviceSecret) {
        return { ok: false, error: data.error ?? "Pairing failed" };
      }
      this.cred = {
        deviceId: data.deviceId,
        deviceSecret: data.deviceSecret,
        deviceName: data.deviceName ?? "Windows PC",
        webUrl: data.webUrl ?? this.cred.webUrl,
      };
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Pairing failed",
      };
    }
  }

  getCredential(): DeviceCredential {
    return this.cred;
  }
}
