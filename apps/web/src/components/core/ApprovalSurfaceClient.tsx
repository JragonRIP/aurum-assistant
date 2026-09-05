"use client";

import { useState } from "react";
import { ApprovalSurface } from "@aurum/ui";

export function ApprovalSurfaceClient(props: {
  pending?: boolean;
  approvalId?: string | null;
  actionLabel?: string | null;
  onResolved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    if (!props.approvalId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${props.approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await res.json()) as {
        error?: string;
        result?: {
          success?: boolean;
          message?: string;
          error?: { message?: string };
        };
      };
      if (!res.ok) throw new Error(data.error ?? "Could not update approval");
      if (decision === "reject") {
        setDone("Cancelled.");
      } else if (data.result?.success) {
        setDone(data.result.message ?? "Approved and executed.");
      } else {
        setDone(
          data.result?.error?.message ??
            data.result?.message ??
            "Approved, but the action failed.",
        );
      }
      props.onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ApprovalSurface
      pending={props.pending}
      approvalId={props.approvalId}
      actionLabel={props.actionLabel}
      busy={busy}
      error={error}
      done={done}
      onApprove={() => void decide("approve")}
      onReject={() => void decide("reject")}
    />
  );
}
