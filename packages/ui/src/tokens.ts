/**
 * Aurum design tokens — precision-machined premium software.
 * Near-black / graphite / warm metallic gold / off-white text.
 * Gold is reserved for identity, focus, and successful action.
 */
export const aurumTokens = {
  color: {
    bg: "#0a0a0b",
    surface: "#121214",
    graphite: "#1a1a1d",
    charcoal: "#222226",
    elevated: "#2a2a2f",
    border: "rgba(255, 255, 255, 0.08)",
    borderStrong: "rgba(255, 255, 255, 0.14)",
    gold: "#c4a574",
    goldSoft: "rgba(196, 165, 116, 0.12)",
    goldBright: "#d8c09a",
    goldIllumination: "rgba(196, 165, 116, 0.08)",
    text: "#f2efe9",
    textMuted: "#9a9690",
    textDim: "#6b6862",
    danger: "#c45c5c",
    success: "#6a9b7a",
    warning: "#c4a04a",
  },
  radius: {
    sm: "4px",
    md: "8px",
    lg: "12px",
  },
  shadow: {
    soft: "0 8px 32px rgba(0, 0, 0, 0.45)",
    overlay: "0 16px 48px rgba(0, 0, 0, 0.55)",
    illuminate: "0 0 0 1px rgba(196, 165, 116, 0.22), 0 0 28px rgba(196, 165, 116, 0.06)",
  },
  motion: {
    ui: "180ms",
    uiMax: "250ms",
    presence: "6s",
    ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  },
  font: {
    display: '"Fraunces", "Georgia", serif',
    body: '"Sora", "Segoe UI", sans-serif',
    mono: '"IBM Plex Mono", "Consolas", monospace',
  },
} as const;

export type AurumTokens = typeof aurumTokens;
