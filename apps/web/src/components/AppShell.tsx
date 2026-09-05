"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CommandBar } from "@aurum/ui";
import { CORE_HREF, PRODUCT, isCorePath } from "@aurum/shared";
import { SystemRail } from "./SystemRail";
import { AurumProvider, useAurum } from "@/components/core/AurumProvider";
import { SearchOverlay } from "@/components/core/SearchOverlay";
import type { SystemStatusSnapshot } from "@/lib/system/status";

export function AppShell({
  children,
  status,
}: {
  children: React.ReactNode;
  status: SystemStatusSnapshot;
}) {
  return (
    <AurumProvider aiConfigured={status.ai === "ONLINE"}>
      <AppShellInner status={status}>{children}</AppShellInner>
    </AurumProvider>
  );
}

function AppShellInner({
  children,
  status,
}: {
  children: React.ReactNode;
  status: SystemStatusSnapshot;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const aurum = useAurum();

  return (
    <div className="flex min-h-dvh w-full">
      <div className="hidden md:flex">
        <SystemRail status={status} />
      </div>

      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-[var(--aurum-border)] bg-[var(--aurum-bg)]/90 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)]"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
        >
          Menu
        </button>
        <Link
          href={CORE_HREF}
          className="aurum-kicker"
          onClick={() => aurum.returnHome()}
        >
          {PRODUCT.name}
        </Link>
        <button
          type="button"
          className="aurum-focus-ring text-[13px] text-[var(--aurum-text-muted)]"
          onClick={() => aurum.setSearchOpen(true)}
        >
          Search
        </button>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[176px] bg-[var(--aurum-bg)] shadow-[var(--aurum-shadow-soft)]">
            <SystemRail
              status={status}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col pt-12 md:h-dvh md:overflow-hidden md:pt-0">
        {children}
        <ShellCommand />
      </main>
      <SearchOverlay />
    </div>
  );
}

function ShellCommand() {
  const pathname = usePathname();
  const router = useRouter();
  const aurum = useAurum();

  if (isCorePath(pathname)) {
    return null;
  }

  return (
    <div className="shrink-0 px-6 py-4 md:px-12">
      <CommandBar
        value={aurum.command}
        onChange={aurum.setCommand}
        onSubmit={(text) => {
          router.push(CORE_HREF);
          void aurum.handleSend(text);
        }}
        onCancel={() => {
          if (aurum.streaming) aurum.handleStop();
          else aurum.setCommand("");
        }}
        streaming={aurum.streaming}
        onStop={aurum.handleStop}
        placeholder="What do you need?"
        aiConfigured={aurum.aiConfigured}
      />
    </div>
  );
}
