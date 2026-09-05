"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SystemStatusSnapshot } from "@/lib/system/status";
import { coreStatusLine, countUnavailableServices } from "@aurum/shared";

export function SystemHealth({
  status,
  compactLabel,
}: {
  status: SystemStatusSnapshot;
  compactLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const unavailable = countUnavailableServices(status);
  const label =
    compactLabel ??
    coreStatusLine({
      aiOnline: status.ai === "ONLINE",
      unavailableCount: unavailable,
    });

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const rows: Array<{ label: string; value: string; ok: boolean; href: string }> =
    [
      {
        label: "AI",
        value: status.ai === "ONLINE" ? "Online" : "Offline",
        ok: status.ai === "ONLINE",
        href: "/settings",
      },
      {
        label: "Memory",
        value: status.memory === "READY" ? "Ready" : "Not configured",
        ok: status.memory === "READY",
        href: "/memory",
      },
      {
        label: "Desktop",
        value:
          status.desktop === "CONNECTED"
            ? "Connected"
            : status.desktop === "OFFLINE"
              ? "Offline"
              : "Not connected",
        ok: status.desktop === "CONNECTED",
        href: "/devices",
      },
      {
        label: "Calendar",
        value:
          status.calendar === "CONNECTED" ? "Connected" : "Not connected",
        ok: status.calendar === "CONNECTED",
        href: "/calendar",
      },
    ];

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        className="aurum-focus-ring inline-flex items-center gap-2 text-[13px] text-[var(--aurum-text-muted)]"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background:
              status.ai === "ONLINE"
                ? "var(--aurum-gold)"
                : "var(--aurum-text-dim)",
          }}
        />
        <span>{label}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="System status"
          className="aurum-surface absolute left-1/2 top-full z-30 mt-3 w-[240px] -translate-x-1/2 p-4 shadow-[var(--aurum-shadow-overlay)]"
        >
          <div className="space-y-2.5 text-[13px]">
            {rows.map((row) => (
              <a
                key={row.label}
                href={row.href}
                className="aurum-focus-ring flex items-baseline justify-between gap-4 rounded-sm"
              >
                <span className="text-[var(--aurum-text-muted)]">
                  {row.label}
                </span>
                <span
                  style={{
                    color: row.ok
                      ? "var(--aurum-gold)"
                      : "var(--aurum-text-dim)",
                  }}
                >
                  {row.value}
                </span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
