import type { ReactNode } from "react";

export interface StatusBadgeProps {
  label: string;
  tone?: "neutral" | "gold" | "success" | "warning" | "danger";
}

const toneColor: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  neutral: "var(--aurum-text-muted)",
  gold: "var(--aurum-gold)",
  success: "var(--aurum-success)",
  warning: "var(--aurum-warning)",
  danger: "var(--aurum-danger)",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  const color = toneColor[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--aurum-font-body)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: color,
        }}
      />
      {label}
    </span>
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 10,
        padding: "20px 0",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--aurum-font-body)",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--aurum-text)",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          maxWidth: 420,
          fontFamily: "var(--aurum-font-body)",
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--aurum-text-muted)",
        }}
      >
        {description}
      </p>
      {action}
    </div>
  );
}

export interface NotConnectedBannerProps {
  feature: string;
  phase?: number;
}

/** Honest UI for features that exist in navigation but are not wired yet */
export function NotConnectedBanner({ feature, phase }: NotConnectedBannerProps) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 0",
        borderTop: "1px solid var(--aurum-border)",
        borderBottom: "1px solid var(--aurum-border)",
        color: "var(--aurum-text-muted)",
        fontFamily: "var(--aurum-font-body)",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span>{feature}</span>
      <span style={{ color: "var(--aurum-text-dim)" }}>
        Not connected
        {phase != null ? ` · Phase ${phase}` : ""}
      </span>
    </div>
  );
}
