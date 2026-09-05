export const PRESENCE_VIEWBOX = 400;
export const PRESENCE_CX = 200;
export const PRESENCE_CY = 200;
export const PRESENCE_USES_RASTER_ASSET = false;
export const RADIAL_TICK_COUNT = 72;
export const MICRO_TICK_COUNT = 120;
export const STRUCTURAL_SEGMENTS = 16;
export const INDICATOR_COUNT = 6;

export const PRESENCE_LAYER_IDS = [
  "housing",
  "ticks",
  "structural",
  "primary-arc",
  "secondary-arc",
  "indicators",
  "micro",
  "inner-track",
  "crosshair",
  "core",
  "glow",
  "thinking",
  "acting",
  "hold",
  "error",
] as const;

export const PRESENCE_STATES = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "ACTING",
  "SPEAKING",
  "WAITING_FOR_APPROVAL",
  "ERROR",
  "OFFLINE",
] as const;

export type PresenceGeometryState = (typeof PRESENCE_STATES)[number];

export function polar(
  cx: number,
  cy: number,
  r: number,
  deg: number,
): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  let sweep = endDeg - startDeg;
  if (sweep < 0) sweep += 360;
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)}A${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function tickPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  count: number,
  majorEvery: number,
  midEvery?: number,
): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const deg = (i / count) * 360;
    const major = i % majorEvery === 0;
    const mid = midEvery != null && i % midEvery === 0;
    const r0 = major ? inner - 5 : mid ? inner - 2 : inner;
    const r1 = major ? outer + 1.5 : outer;
    const a = polar(cx, cy, r0, deg);
    const b = polar(cx, cy, r1, deg);
    parts.push(
      `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
    );
  }
  return parts.join("");
}

export function radialHatch(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  startDeg: number,
  count: number,
  step: number,
): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const deg = startDeg + i * step;
    const a = polar(cx, cy, inner, deg);
    const b = polar(cx, cy, outer, deg);
    parts.push(
      `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
    );
  }
  return parts.join("");
}

export type HousingArc = {
  start: number;
  end: number;
  r: number;
  width: number;
  tone: "gold" | "gold-soft" | "steel" | "steel-bright";
};

export const HOUSING_ARCS: readonly HousingArc[] = [
  { start: 8, end: 52, r: 192, width: 11.5, tone: "gold" },
  { start: 56, end: 94, r: 196.2, width: 3.4, tone: "steel" },
  { start: 98, end: 146, r: 193.2, width: 8.8, tone: "steel-bright" },
  { start: 150, end: 178, r: 196.4, width: 3.6, tone: "steel" },
  { start: 182, end: 246, r: 192.4, width: 11, tone: "steel-bright" },
  { start: 250, end: 286, r: 195.2, width: 4.6, tone: "gold-soft" },
  { start: 290, end: 338, r: 193.6, width: 9.2, tone: "steel" },
  { start: 342, end: 4, r: 196, width: 3.2, tone: "steel" },
];

export const INDICATOR_ANGLES = [18, 74, 128, 196, 248, 312] as const;

export const DOUBLE_HOUSING = [
  { start: 8, end: 52, r: 184.8 },
  { start: 182, end: 246, r: 184.6 },
  { start: 290, end: 338, r: 186.4 },
] as const;

export type StructuralTone = "bright" | "mid" | "dark";

export const STRUCTURAL_ARCS: readonly {
  start: number;
  end: number;
  tone: StructuralTone;
}[] = Array.from({ length: STRUCTURAL_SEGMENTS }, (_, i) => {
  const sweep = 360 / STRUCTURAL_SEGMENTS;
  const gap = 1.35;
  const tone: StructuralTone =
    i % 4 === 0 ? "bright" : i % 2 === 0 ? "mid" : "dark";
  return {
    start: i * sweep + gap / 2,
    end: (i + 1) * sweep - gap / 2,
    tone,
  };
});

export const CARDINAL_PIP_ANGLES = [0, 90, 180, 270] as const;

export function structuralDash(radius: number, segments: number): string {
  const c = 2 * Math.PI * radius;
  const gap = c * 0.012;
  const dash = c / segments - gap;
  return `${dash.toFixed(2)} ${gap.toFixed(2)}`;
}

export function presenceMotionProfile(
  state: PresenceGeometryState,
  reducedMotion: boolean,
  presentation?:
    | "idle"
    | "thinking"
    | "acting"
    | "responding"
    | "hold"
    | "success"
    | "error"
    | "offline"
    | "listening"
    | "speaking",
): {
  rotate: boolean;
  thinking: boolean;
  acting: boolean;
  responding: boolean;
  hold: boolean;
  error: boolean;
  offline: boolean;
} {
  const responding = presentation === "responding";
  if (reducedMotion) {
    return {
      rotate: false,
      thinking: false,
      acting: false,
      responding: false,
      hold: state === "WAITING_FOR_APPROVAL",
      error: state === "ERROR",
      offline: state === "OFFLINE",
    };
  }
  return {
    rotate: state !== "OFFLINE" && state !== "WAITING_FOR_APPROVAL",
    thinking:
      !responding && (state === "THINKING" || state === "LISTENING"),
    acting: state === "ACTING" || state === "SPEAKING",
    responding,
    hold: state === "WAITING_FOR_APPROVAL",
    error: state === "ERROR",
    offline: state === "OFFLINE",
  };
}
