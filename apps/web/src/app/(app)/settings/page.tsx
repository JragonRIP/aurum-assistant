import { StatusBadge } from "@aurum/ui";
import { hasGeminiConfig, hasSupabaseConfig, getPublicEnv } from "@/lib/env";
import { getTextModel } from "@aurum/ai";
import Link from "next/link";
import { Suspense } from "react";
import { SYSTEM_ITEMS } from "@aurum/shared";
import { IntegrationsPanel } from "@/components/settings/IntegrationsPanel";
import { DesktopUpdatePanel } from "@/components/settings/DesktopUpdatePanel";

export default function SettingsPage() {
  const configured = {
    supabase: hasSupabaseConfig(),
    gemini: hasGeminiConfig(),
  };
  const { appEnv, appUrl } = getPublicEnv();
  const model = configured.gemini ? getTextModel(process.env) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10 md:px-14 md:py-14">
      <header className="mb-12 max-w-2xl">
        <h1
          className="text-[28px] font-medium text-[var(--aurum-text)]"
          style={{ fontFamily: "var(--aurum-font-display)" }}
        >
          Settings
        </h1>
        <p className="mt-2 text-[14px] text-[var(--aurum-text-muted)]">
          Aurum, integrations, and system areas.
        </p>
      </header>

      <div className="max-w-2xl space-y-14">
        <section>
          <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
            Aurum
          </h2>
          <dl>
            <Row label="Environment" value={appEnv} />
            <Row label="App URL" value={appUrl} />
            <div className="flex items-center justify-between gap-4 border-b border-[var(--aurum-border)] py-3">
              <span className="text-[14px] text-[var(--aurum-text-muted)]">
                Supabase
              </span>
              <StatusBadge
                label={configured.supabase ? "Configured" : "Missing"}
                tone={configured.supabase ? "success" : "warning"}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-[var(--aurum-border)] py-3">
              <span className="text-[14px] text-[var(--aurum-text-muted)]">
                Gemini
              </span>
              <StatusBadge
                label={configured.gemini ? "Configured" : "Missing"}
                tone={configured.gemini ? "success" : "warning"}
              />
            </div>
            {model ? <Row label="Text model" value={model} /> : null}
          </dl>
        </section>

        <section>
          <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
            Desktop
          </h2>
          <DesktopUpdatePanel />
          <p className="py-3 text-[13px] text-[var(--aurum-text-dim)]">
            Update controls appear when Settings is opened from the installed
            Aurum Windows app.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
            Integrations
          </h2>
          <Suspense
            fallback={
              <p className="py-3 text-[14px] text-[var(--aurum-text-muted)]">
                Loading…
              </p>
            }
          >
            <IntegrationsPanel />
          </Suspense>
        </section>

        <section>
          <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
            System
          </h2>
          <ul>
            {SYSTEM_ITEMS.map((item) => (
              <li
                key={item.id}
                className="border-b border-[var(--aurum-border)]"
              >
                <Link
                  href={item.href}
                  className="aurum-focus-ring flex items-baseline justify-between gap-4 py-3"
                >
                  <span className="text-[15px] text-[var(--aurum-text)]">
                    {item.label}
                  </span>
                  <span className="text-[13px] text-[var(--aurum-text-dim)]">
                    {item.connected ? "Registered" : "Not configured"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-1 text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
            Account
          </h2>
          <Link
            href="/account"
            className="aurum-focus-ring inline-flex py-3 text-[15px] text-[var(--aurum-text)]"
          >
            Profile and sign out
          </Link>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--aurum-border)] py-3">
      <span className="text-[14px] text-[var(--aurum-text-muted)]">{label}</span>
      <span
        className="truncate text-[13px] text-[var(--aurum-text)]"
        style={{ fontFamily: "var(--aurum-font-mono)" }}
      >
        {value}
      </span>
    </div>
  );
}
