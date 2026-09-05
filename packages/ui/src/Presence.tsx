"use client";

import { memo, useId } from "react";
import {
  CARDINAL_PIP_ANGLES,
  DOUBLE_HOUSING,
  HOUSING_ARCS,
  INDICATOR_ANGLES,
  MICRO_TICK_COUNT,
  PRESENCE_CX as CX,
  PRESENCE_CY as CY,
  PRESENCE_VIEWBOX,
  RADIAL_TICK_COUNT,
  STRUCTURAL_ARCS,
  describeArc,
  polar,
  radialHatch,
  tickPath,
} from "./presence-geometry";

export type PresenceState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "ACTING"
  | "SPEAKING"
  | "WAITING_FOR_APPROVAL"
  | "ERROR"
  | "OFFLINE";

export type PresencePresentation =
  | "idle"
  | "thinking"
  | "acting"
  | "responding"
  | "hold"
  | "success"
  | "error"
  | "offline"
  | "listening"
  | "speaking";

export interface AurumPresenceProps {
  state: PresenceState;
  size?: "sm" | "md" | "lg" | "xl";
  label?: string;
  presentation?: PresencePresentation;
}

function presentationFromState(state: PresenceState): PresencePresentation {
  switch (state) {
    case "THINKING":
      return "thinking";
    case "ACTING":
      return "acting";
    case "SPEAKING":
      return "speaking";
    case "LISTENING":
      return "listening";
    case "WAITING_FOR_APPROVAL":
      return "hold";
    case "ERROR":
      return "error";
    case "OFFLINE":
      return "offline";
    default:
      return "idle";
  }
}

const TICKS = tickPath(CX, CY, 174, 182.5, RADIAL_TICK_COUNT, 12, 3);
const MAJOR_TICKS = tickPath(CX, CY, 182, 190, 24, 1);
const MICRO = tickPath(CX, CY, 79, 84.5, MICRO_TICK_COUNT, 15, 5);
const STRUCT_R = 161;
const LOCK = radialHatch(CX, CY, 86, 93, 168, 8, 2.15);

function housingClass(tone: (typeof HOUSING_ARCS)[number]["tone"]): string {
  switch (tone) {
    case "gold":
      return "acv-stroke-gold";
    case "gold-soft":
      return "acv-stroke-gold-soft";
    case "steel-bright":
      return "acv-stroke-steel-bright";
    default:
      return "acv-stroke-steel";
  }
}

function structuralClass(tone: (typeof STRUCTURAL_ARCS)[number]["tone"]): string {
  switch (tone) {
    case "bright":
      return "acv-struct-bright";
    case "mid":
      return "acv-struct-mid";
    default:
      return "acv-struct-dark";
  }
}

/**
 * Aurum Core visual — layered SVG instrument.
 * Same presence state API. No raster reference image.
 */
function AurumPresenceInner({
  state,
  size = "md",
  label,
  presentation: presentationProp,
}: AurumPresenceProps) {
  const uid = useId().replace(/:/g, "");
  const glow = `acv-glow-${uid}`;
  const metal = `acv-metal-${uid}`;
  const gold = `acv-gold-${uid}`;
  const ember = `acv-ember-${uid}`;
  const emberGlow = `acv-ember-glow-${uid}`;
  const presentation = presentationProp ?? presentationFromState(state);
  const caption = label ?? state.replaceAll("_", " ");
  const error = state === "ERROR";

  return (
    <span
      className="aurum-presence"
      data-state={state}
      data-size={size}
      data-presentation={presentation}
      data-aurum-core="true"
      data-persistent="true"
      role="img"
      aria-label={`Aurum ${caption.toLowerCase()}`}
    >
      <svg
        className="aurum-presence-svg"
        viewBox={`0 0 ${PRESENCE_VIEWBOX} ${PRESENCE_VIEWBOX}`}
        aria-hidden
        focusable="false"
      >
        <defs>
          <radialGradient id={glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#d8c09a" stopOpacity="0.55" />
            <stop offset="38%" stopColor="#c4a574" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#c4a574" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={metal} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3a3a40" />
            <stop offset="45%" stopColor="#222226" />
            <stop offset="100%" stopColor="#141416" />
          </linearGradient>
          <linearGradient id={gold} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e2d0ae" />
            <stop offset="50%" stopColor="#c4a574" />
            <stop offset="100%" stopColor="#8f7350" />
          </linearGradient>
          <radialGradient id={emberGlow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#c45c5c" stopOpacity="0.5" />
            <stop offset="42%" stopColor="#8a3a38" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#8a3a38" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={ember} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c47a74" />
            <stop offset="50%" stopColor="#a45a52" />
            <stop offset="100%" stopColor="#6e3834" />
          </linearGradient>
        </defs>

        <g data-layer="glow" className="acv-glow">
          <circle
            cx={CX}
            cy={CY}
            r="34"
            fill={`url(#${error ? emberGlow : glow})`}
          />
        </g>

        <g data-layer="housing" className="acv-housing">
          <circle
            cx={CX}
            cy={CY}
            r="194.5"
            fill="none"
            stroke={`url(#${metal})`}
            strokeWidth="2.2"
            opacity="0.7"
          />
          {HOUSING_ARCS.map((arc) => (
            <path
              key={`${arc.start}-${arc.r}`}
              d={describeArc(CX, CY, arc.r, arc.start, arc.end)}
              className={housingClass(arc.tone)}
              fill="none"
              strokeWidth={arc.width}
              strokeLinecap="butt"
            />
          ))}
          {DOUBLE_HOUSING.map((arc) => (
            <path
              key={`dbl-${arc.start}`}
              d={describeArc(CX, CY, arc.r, arc.start, arc.end)}
              className="acv-stroke-gold-dim"
              fill="none"
              strokeWidth="1.15"
            />
          ))}
          <path
            d={radialHatch(CX, CY, 188, 200, 258, 6, 2.4)}
            className="acv-stroke-steel-bright"
            fill="none"
            strokeWidth="1.05"
          />
          <path
            d={radialHatch(CX, CY, 190, 198, 108, 5, 1.9)}
            className="acv-stroke-steel"
            fill="none"
            strokeWidth="0.85"
          />
          {[308, 314, 320].map((deg) => {
            const p = polar(CX, CY, 193.6, deg);
            return (
              <circle
                key={deg}
                cx={p.x}
                cy={p.y}
                r="1.25"
                className="acv-fill-steel"
              />
            );
          })}
          <path
            d={describeArc(CX, CY, 199.4, 10, 24)}
            className="acv-stroke-gold"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="square"
          />
          <path
            d={describeArc(CX, CY, 199.8, 198, 226)}
            className="acv-stroke-steel-bright"
            fill="none"
            strokeWidth="2.4"
            strokeLinecap="butt"
          />
        </g>

        <g data-layer="ticks" className="acv-layer acv-ticks">
          <path
            d={TICKS}
            className="acv-stroke-tick"
            fill="none"
            strokeWidth="0.65"
          />
          <path
            d={MAJOR_TICKS}
            className="acv-stroke-tick"
            fill="none"
            strokeWidth="0.95"
            opacity="0.85"
          />
          <path
            d={`M${CX} ${CY - 182}L${CX} ${CY - 196}`}
            className="acv-stroke-gold"
            fill="none"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </g>

        <g data-layer="structural" className="acv-structural acv-struct-mass">
          {STRUCTURAL_ARCS.map((arc) => (
            <path
              key={`struct-${arc.start}`}
              d={describeArc(CX, CY, STRUCT_R, arc.start, arc.end)}
              className={structuralClass(arc.tone)}
              fill="none"
              strokeWidth="20"
              strokeLinecap="butt"
            />
          ))}
          <circle
            cx={CX}
            cy={CY}
            r="171.2"
            fill="none"
            className="acv-stroke-steel-bright"
            strokeWidth="0.55"
            opacity="0.55"
          />
          <circle
            cx={CX}
            cy={CY}
            r="150.6"
            fill="none"
            className="acv-stroke-steel"
            strokeWidth="0.7"
            opacity="0.8"
          />
          <path
            d={describeArc(CX, CY, STRUCT_R, 226, 248)}
            className="acv-stroke-gold"
            fill="none"
            strokeWidth="7.5"
            strokeLinecap="round"
          />
        </g>

        <g data-layer="indicators" className="acv-indicators">
          {INDICATOR_ANGLES.map((deg, i) => {
            const p = polar(CX, CY, 150.5, deg);
            return (
              <circle
                key={deg}
                cx={p.x}
                cy={p.y}
                r="1.7"
                className={`acv-indicator acv-indicator-${i}`}
              />
            );
          })}
        </g>

        <g data-layer="primary-arc" className="acv-layer acv-primary">
          <circle
            cx={CX}
            cy={CY}
            r="133"
            fill="none"
            className="acv-stroke-track"
            strokeWidth="1.15"
          />
          <circle
            cx={CX}
            cy={CY}
            r="133"
            fill="none"
            className="acv-stroke-gold"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray="560 276"
            transform={`rotate(-18 ${CX} ${CY})`}
          />
          <path
            d={describeArc(CX, CY, 124, 198, 228)}
            className="acv-stroke-gold"
            fill="none"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
        </g>

        <g data-layer="secondary-arc" className="acv-layer acv-secondary">
          <circle
            cx={CX}
            cy={CY}
            r="114"
            fill="none"
            className="acv-stroke-track"
            strokeWidth="0.7"
            strokeDasharray="4 10"
          />
          <path
            d={describeArc(CX, CY, 114, 40, 118)}
            className="acv-stroke-gold-soft"
            fill="none"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </g>

        <g data-layer="micro" className="acv-layer acv-micro">
          <path
            d={MICRO}
            className="acv-stroke-micro"
            fill="none"
            strokeWidth="0.45"
          />
          <path
            d={describeArc(CX, CY, 88, 250, 298)}
            className="acv-stroke-gold-dim"
            fill="none"
            strokeWidth="1.1"
          />
          <path
            d={LOCK}
            className="acv-stroke-gold-dim"
            fill="none"
            strokeWidth="0.7"
          />
          {[176, 184].map((deg) => {
            const p = polar(CX, CY, 90.5, deg);
            return (
              <rect
                key={deg}
                x={p.x - 1.1}
                y={p.y - 1.1}
                width="2.2"
                height="2.2"
                className="acv-fill-gold-soft"
                transform={`rotate(${deg} ${p.x} ${p.y})`}
              />
            );
          })}
        </g>

        <g data-layer="inner-track" className="acv-layer acv-inner">
          <circle
            cx={CX}
            cy={CY}
            r="96"
            fill="none"
            className="acv-stroke-track"
            strokeWidth="0.55"
          />
          <path
            d={describeArc(CX, CY, 96, 310, 18)}
            className="acv-stroke-gold-soft"
            fill="none"
            strokeWidth="0.9"
            strokeLinecap="round"
          />
          <circle
            cx={CX}
            cy={CY}
            r="68"
            fill="none"
            className="acv-stroke-steel"
            strokeWidth="0.5"
            opacity="0.8"
          />
          {CARDINAL_PIP_ANGLES.map((deg) => {
            const p = polar(CX, CY, 68, deg);
            return (
              <circle
                key={`pip-${deg}`}
                cx={p.x}
                cy={p.y}
                r="1.15"
                className="acv-fill-gold-soft"
              />
            );
          })}
          <circle
            cx={CX}
            cy={CY}
            r="52"
            fill="none"
            className="acv-stroke-gold-dim"
            strokeWidth="0.7"
          />
          <circle
            cx={CX}
            cy={CY}
            r="44"
            fill="none"
            className="acv-stroke-track"
            strokeWidth="0.45"
            strokeDasharray="2 6"
          />
        </g>

        <g data-layer="thinking" className="acv-overlay acv-thinking">
          <circle
            cx={CX}
            cy={CY}
            r="141"
            fill="none"
            className="acv-stroke-gold-soft"
            strokeWidth="1.2"
            strokeDasharray="90 800"
            strokeLinecap="round"
          />
          <circle
            cx={CX}
            cy={CY}
            r="178"
            fill="none"
            className="acv-stroke-gold"
            strokeWidth="1.05"
            strokeDasharray="10 24"
            strokeLinecap="butt"
            opacity="0.7"
          />
        </g>

        <g data-layer="acting" className="acv-overlay acv-acting">
          <circle
            cx={CX}
            cy={CY}
            r="141"
            fill="none"
            className="acv-stroke-gold"
            strokeWidth="1.8"
            strokeDasharray="48 840"
            strokeLinecap="round"
          />
        </g>

        <g data-layer="success" className="acv-overlay acv-success-pulse">
          <circle
            cx={CX}
            cy={CY}
            r="161"
            fill="none"
            className="acv-pulse-ring"
            stroke="rgba(196,165,116,0.28)"
            strokeWidth="1.2"
          />
        </g>

        <g data-layer="hold" className="acv-overlay acv-hold">
          <path
            d={describeArc(CX, CY, 133, 300, 20)}
            className="acv-stroke-gold"
            fill="none"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d={describeArc(CX, CY, 114, 110, 168)}
            className="acv-stroke-gold-soft"
            fill="none"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>

        <g data-layer="error" className="acv-overlay acv-error">
          <circle
            cx={CX}
            cy={CY}
            r="141"
            fill="none"
            className="acv-error-ring"
            stroke="rgba(196,92,92,0.45)"
            strokeWidth="1.3"
            strokeDasharray="40 40"
          />
          <circle
            cx={polar(CX, CY, 150.5, 18).x}
            cy={polar(CX, CY, 150.5, 18).y}
            r="2.1"
            className="acv-error-dot"
          />
        </g>

        <g data-layer="crosshair" className="acv-crosshair">
          <line
            x1="78"
            y1={CY}
            x2="168"
            y2={CY}
            className="acv-cross"
          />
          <line
            x1="232"
            y1={CY}
            x2="322"
            y2={CY}
            className="acv-cross"
          />
          <line
            x1={CX}
            y1="78"
            x2={CX}
            y2="168"
            className="acv-cross"
          />
          <line
            x1={CX}
            y1="232"
            x2={CX}
            y2="322"
            className="acv-cross"
          />
        </g>

        <g data-layer="core" className="acv-core-wrap">
          <circle
            cx={CX}
            cy={CY}
            r="22"
            fill="none"
            className="acv-stroke-gold-dim"
            strokeWidth="0.6"
          />
          <circle
            cx={CX}
            cy={CY}
            r="14.5"
            fill="none"
            className="acv-stroke-gold-soft"
            strokeWidth="0.85"
          />
          <circle
            cx={CX}
            cy={CY}
            r="6.2"
            fill={`url(#${error ? ember : gold})`}
            className="acv-core"
          />
        </g>
      </svg>
    </span>
  );
}

export const AurumPresence = memo(AurumPresenceInner);
AurumPresence.displayName = "AurumPresence";

export const AurumCoreVisual = AurumPresence;
