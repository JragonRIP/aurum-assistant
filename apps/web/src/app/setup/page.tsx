import Link from "next/link";
import { PRODUCT } from "@aurum/shared";
import { hasSupabaseConfig, hasGeminiConfig } from "@/lib/env";
import { StatusBadge, Button } from "@aurum/ui";

export default function SetupPage() {
  const supabase = hasSupabaseConfig();
  const gemini = hasGeminiConfig();

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--aurum-gold)]">
        {PRODUCT.name}
      </div>
      <h1
        className="mt-3 text-[40px] leading-none text-[var(--aurum-text)]"
        style={{ fontFamily: "var(--aurum-font-display)", fontWeight: 500 }}
      >
        Setup
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--aurum-text-muted)]">
        Supabase powers auth and storage. Gemini powers the Phase 2 text
        assistant (server-side key only).
      </p>

      <div className="aurum-surface mt-8 space-y-5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] text-[var(--aurum-text)]">Supabase</div>
            <div className="text-[12px] text-[var(--aurum-text-dim)]">
              NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
            </div>
          </div>
          <StatusBadge
            label={supabase ? "Ready" : "Required"}
            tone={supabase ? "success" : "warning"}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] text-[var(--aurum-text)]">Gemini</div>
            <div className="text-[12px] text-[var(--aurum-text-dim)]">
              GEMINI_API_KEY (server only) · optional GEMINI_TEXT_MODEL
            </div>
          </div>
          <StatusBadge
            label={gemini ? "Ready" : "Required for chat"}
            tone={gemini ? "success" : "warning"}
          />
        </div>
      </div>

      <ol className="mt-8 list-decimal space-y-3 pl-5 text-[14px] text-[var(--aurum-text-muted)]">
        <li>
          Create a project at{" "}
          <a
            className="text-[var(--aurum-gold)]"
            href="https://supabase.com"
            target="_blank"
            rel="noreferrer"
          >
            supabase.com
          </a>
        </li>
        <li>
          Copy{" "}
          <code className="text-[var(--aurum-text)]">.env.example</code> to{" "}
          <code className="text-[var(--aurum-text)]">apps/web/.env.local</code>
        </li>
        <li>Paste Project URL and anon key from Settings → API</li>
        <li>
          Run SQL migrations:{" "}
          <code className="text-[var(--aurum-text)]">
            20260322000000_phase1_foundation.sql
          </code>{" "}
          then{" "}
          <code className="text-[var(--aurum-text)]">
            20260322010000_phase2_assistant.sql
          </code>
        </li>
        <li>
          Add{" "}
          <code className="text-[var(--aurum-text)]">GEMINI_API_KEY</code> for
          live streaming chat
        </li>
        <li>Restart the web app and create your account at /signup</li>
      </ol>

      <div className="mt-10 flex gap-3">
        {supabase ? (
          <Link href="/login">
            <Button variant="primary">Continue to sign in</Button>
          </Link>
        ) : (
          <Button variant="primary" disabled>
            Waiting for Supabase config
          </Button>
        )}
        <Link href="/">
          <Button variant="secondary">View UI shell</Button>
        </Link>
      </div>
    </div>
  );
}
