"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BOTTOM_RAIL,
  CORE_HREF,
  PRIMARY_RAIL,
  PRODUCT,
  parseRailExpanded,
  serializeRailExpanded,
  RAIL_EXPANDED_KEY,
  isCorePath,
  type RailItem,
} from "@aurum/shared";
import type { SystemStatusSnapshot } from "@/lib/system/status";
import { useAurum } from "@/components/core/AurumProvider";

function isRailActive(pathname: string, item: RailItem): boolean {
  if (item.id === "core") return isCorePath(pathname);
  if (item.id === "business") {
    return (
      pathname === "/business" ||
      pathname.startsWith("/clients") ||
      pathname.startsWith("/leads")
    );
  }
  if (item.id === "settings") {
    return (
      pathname === "/settings" ||
      pathname.startsWith("/devices") ||
      pathname.startsWith("/memory") ||
      pathname.startsWith("/automations")
    );
  }
  if (!item.href) return false;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function RailGlyph({ id }: { id: RailItem["id"] }) {
  switch (id) {
    case "core":
      return (
        <Icon>
          <circle cx="12" cy="12" r="7.5" />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        </Icon>
      );
    case "search":
      return (
        <Icon>
          <circle cx="11" cy="11" r="6" />
          <path d="M15.5 15.5 20 20" />
        </Icon>
      );
    case "tasks":
      return (
        <Icon>
          <path d="M8 7h10M8 12h10M8 17h7" />
          <path d="M5 7.2l.8.8 1.6-1.8M5 12.2l.8.8 1.6-1.8" />
        </Icon>
      );
    case "calendar":
      return (
        <Icon>
          <rect x="4.5" y="6" width="15" height="13.5" rx="1.2" />
          <path d="M4.5 10h15M9 4.5v3M15 4.5v3" />
        </Icon>
      );
    case "business":
      return (
        <Icon>
          <circle cx="8" cy="10" r="2.2" />
          <circle cx="16" cy="10" r="2.2" />
          <path d="M6 17c.4-2 1.8-3 4-3s3.6 1 4 3M14 17c.2-1 1-2 2.8-2.4" />
        </Icon>
      );
    case "files":
      return (
        <Icon>
          <path d="M7 5.5h6l4 4V18a1.5 1.5 0 0 1-1.5 1.5h-8.5A1.5 1.5 0 0 1 5.5 18V7A1.5 1.5 0 0 1 7 5.5z" />
          <path d="M13 5.5V10h4.5" />
        </Icon>
      );
    case "activity":
      return (
        <Icon>
          <path d="M4 13h3l2-6 3 10 2-4h6" />
        </Icon>
      );
    case "settings":
      return (
        <Icon>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 5.5v-1.2M12 19.7V18.5M5.5 12H4.3M19.7 12H18.5M7.2 7.2l-.9-.9M17.7 17.7l-.9-.9M16.8 7.2l.9-.9M7.2 16.8l-.9.9" />
        </Icon>
      );
    case "account":
      return (
        <Icon>
          <circle cx="12" cy="9" r="2.6" />
          <path d="M6.5 18c.8-2.6 2.8-4 5.5-4s4.7 1.4 5.5 4" />
        </Icon>
      );
    default:
      return null;
  }
}

function RailControl({
  item,
  pathname,
  expanded,
  onNavigate,
}: {
  item: RailItem;
  pathname: string;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const aurum = useAurum();
  const active = isRailActive(pathname, item);
  const className =
    "aurum-focus-ring aurum-transition flex w-full items-center gap-3 rounded-[var(--aurum-radius-sm)] px-2.5 py-[10px] text-[14px]";
  const style = {
    background: active ? "rgba(196, 165, 116, 0.1)" : "transparent",
    color: active ? "var(--aurum-text)" : "var(--aurum-text-muted)",
    boxShadow: active
      ? "inset 2px 0 0 var(--aurum-gold)"
      : "inset 2px 0 0 transparent",
    justifyContent: expanded ? "flex-start" : "center",
  } as const;

  const inner = (
    <>
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <RailGlyph id={item.id} />
      </span>
      {expanded ? <span>{item.label}</span> : null}
      {!expanded ? <span className="sr-only">{item.label}</span> : null}
    </>
  );

  if (item.kind === "search") {
    return (
      <button
        type="button"
        title={item.label}
        aria-label={item.label}
        aria-current={aurum.searchOpen ? "true" : undefined}
        className={className}
        style={style}
        onClick={() => {
          aurum.setSearchOpen(true);
          onNavigate?.();
        }}
      >
        {inner}
      </button>
    );
  }

  if (item.kind === "activity") {
    return (
      <button
        type="button"
        title={item.label}
        aria-label={item.label}
        className={className}
        style={style}
        onClick={() => {
          aurum.setActivityOpen(true);
          onNavigate?.();
        }}
      >
        {inner}
      </button>
    );
  }

  const href = item.href ?? CORE_HREF;

  return (
    <Link
      href={href}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        if (item.id === "core") aurum.returnHome();
        onNavigate?.();
      }}
      className={className}
      style={style}
    >
      {inner}
    </Link>
  );
}

export function SystemRail({
  status,
  onNavigate,
}: {
  status: SystemStatusSnapshot;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const aurum = useAurum();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      setExpanded(parseRailExpanded(localStorage.getItem(RAIL_EXPANDED_KEY)));
    } catch {
      setExpanded(false);
    }
  }, []);

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_EXPANDED_KEY, serializeRailExpanded(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-[var(--aurum-border)] bg-[var(--aurum-bg)]/80 py-4"
      style={{ width: expanded ? 176 : 72 }}
      aria-label="Aurum"
    >
      <div className={`mb-5 flex items-center ${expanded ? "px-3" : "justify-center px-1"}`}>
        {expanded ? (
          <Link
            href={CORE_HREF}
            onClick={() => {
              aurum.returnHome();
              onNavigate?.();
            }}
            className="aurum-focus-ring aurum-kicker"
          >
            {PRODUCT.name}
          </Link>
        ) : (
          <span className="sr-only">{PRODUCT.name}</span>
        )}
        <button
          type="button"
          className={`aurum-focus-ring text-[12px] text-[var(--aurum-text-dim)] ${expanded ? "ml-auto" : ""}`}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
          onClick={toggleExpanded}
        >
          {expanded ? "‹" : "›"}
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col px-2">
        <div className="flex flex-col gap-0.5">
          {PRIMARY_RAIL.map((item) => (
            <RailControl
              key={item.id}
              item={item}
              pathname={pathname}
              expanded={expanded}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-0.5 border-t border-[var(--aurum-border)] pt-3">
          {BOTTOM_RAIL.map((item) => (
            <RailControl
              key={item.id}
              item={item}
              pathname={pathname}
              expanded={expanded}
              onNavigate={onNavigate}
            />
          ))}
          {status.ai === "OFFLINE" ? (
            <div
              className={`mt-2 text-[11px] text-[var(--aurum-text-dim)] ${expanded ? "px-2.5" : "sr-only"}`}
            >
              Core offline
            </div>
          ) : null}
        </div>
      </nav>
    </aside>
  );
}
