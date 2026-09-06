import { randomUUID } from "node:crypto";
import { getAurumWebUrl } from "./config";
import type { DeviceCredential } from "./credentials";
import { mapOverlayApprovalError } from "./overlay-approval-errors";

export type OverlayChatHandle = { id: string };

export type OverlayApprovalDecisionResult = {
  ok: boolean;
  status?: "APPROVED" | "REJECTED";
  alreadyResolved?: boolean;
  error?: string;
  code?: string;
  result?: {
    success?: boolean;
    message?: string;
    error?: { code?: string; message?: string } | null;
    activityLabel?: string;
  };
};

type ActiveChat = {
  id: string;
  abort: AbortController;
  conversationId: string | null;
};

/**
 * Main-process agent proxy for the overlay.
 * Uses device Bearer auth — never exposes tokens to the renderer.
 */
export class OverlayChatBridge {
  private active = new Map<string, ActiveChat>();
  private conversationId: string | null = null;

  constructor(
    private getCred: () => DeviceCredential | null,
    private onEvent: (
      payload: {
        id: string;
        event?: unknown;
        done?: boolean;
        error?: string;
      },
    ) => void,
  ) {}

  async start(text: string): Promise<OverlayChatHandle> {
    const cred = this.getCred();
    if (!cred) throw new Error("Device not paired");

    const id = randomUUID();
    const abort = new AbortController();
    this.active.set(id, {
      id,
      abort,
      conversationId: this.conversationId,
    });

    void this.run(id, text, cred, abort.signal);
    return { id };
  }

  cancel(id: string): void {
    const chat = this.active.get(id);
    if (chat) {
      chat.abort.abort();
      this.active.delete(id);
      this.onEvent({ id, done: true, error: "Cancelled" });
    }
  }

  /**
   * Resolve a CONFIRM approval via the same canonical backend as the web app.
   * Executes stored validated args — does not re-send the NL request to Gemini.
   */
  async decideApproval(
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<OverlayApprovalDecisionResult> {
    const cred = this.getCred();
    if (!cred) {
      return { ok: false, error: "Device not paired", code: "DEVICE_OFFLINE" };
    }
    if (!/^[0-9a-f-]{36}$/i.test(approvalId)) {
      return { ok: false, error: "Invalid approval", code: "APPROVAL_NOT_FOUND" };
    }
    if (decision !== "approve" && decision !== "reject") {
      return { ok: false, error: "Invalid decision", code: "INVALID_DECISION" };
    }

    console.info("[aurum:overlay-approval]", {
      stage: "request",
      approvalId,
      decision,
      deviceId: cred.deviceId,
    });

    try {
      const res = await fetch(
        `${this.base(cred)}/api/devices/assistant/approvals/${approvalId}/decide`,
        {
          method: "POST",
          headers: {
            Authorization: this.authHeader(cred),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ decision }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: "APPROVED" | "REJECTED";
        alreadyResolved?: boolean;
        error?: string;
        code?: string;
        result?: OverlayApprovalDecisionResult["result"];
      };

      console.info("[aurum:overlay-approval]", {
        stage: "response",
        approvalId,
        decision,
        deviceId: cred.deviceId,
        httpStatus: res.status,
        code: data.code ?? null,
        ok: res.ok,
      });

      if (!res.ok) {
        return {
          ok: false,
          error: mapOverlayApprovalError(data.code, data.error, res.status),
          code: data.code,
        };
      }
      return {
        ok: true,
        status: data.status,
        alreadyResolved: data.alreadyResolved,
        result: data.result,
      };
    } catch (err) {
      console.info("[aurum:overlay-approval]", {
        stage: "network_error",
        approvalId,
        decision,
        deviceId: cred.deviceId,
      });
      void err;
      return {
        ok: false,
        error: "Could not reach Aurum to resolve approval.",
        code: "DEVICE_OFFLINE",
      };
    }
  }

  private authHeader(cred: DeviceCredential): string {
    return `Bearer ${cred.deviceId}.${cred.deviceSecret}`;
  }

  private base(_cred: DeviceCredential): string {
    return getAurumWebUrl();
  }

  private async ensureConversation(cred: DeviceCredential): Promise<string> {
    if (this.conversationId) return this.conversationId;
    const res = await fetch(
      `${this.base(cred)}/api/devices/assistant/conversations`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader(cred),
          "Content-Type": "application/json",
        },
      },
    );
    if (!res.ok) throw new Error("Could not create overlay session");
    const data = (await res.json()) as { conversation: { id: string } };
    this.conversationId = data.conversation.id;
    return this.conversationId;
  }

  private async run(
    id: string,
    text: string,
    cred: DeviceCredential,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const conversationId = await this.ensureConversation(cred);
      const res = await fetch(
        `${this.base(cred)}/api/devices/assistant/chat`,
        {
          method: "POST",
          headers: {
            Authorization: this.authHeader(cred),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId,
            content: text,
            clientSentAt: Date.now(),
            generationId: randomUUID(),
          }),
          signal,
        },
      );
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        this.onEvent({
          id,
          done: true,
          error: body.error ?? `Chat failed (${res.status})`,
        });
        return;
      }

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
          try {
            const event = JSON.parse(json) as { type?: string };
            this.onEvent({ id, event });
            if (event.type === "done" || event.type === "error") {
              this.onEvent({ id, done: true });
              this.active.delete(id);
              return;
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
      this.onEvent({ id, done: true });
    } catch (err) {
      if (signal.aborted) {
        this.onEvent({ id, done: true });
      } else {
        this.onEvent({
          id,
          done: true,
          error: err instanceof Error ? err.message : "Chat failed",
        });
      }
    } finally {
      this.active.delete(id);
    }
  }
}


