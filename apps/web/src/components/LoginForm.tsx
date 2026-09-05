"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@aurum/ui";
import { PRODUCT } from "@aurum/shared";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-10">
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--aurum-gold)]">
          {PRODUCT.name}
        </div>
        <h1
          className="mt-3 text-[36px] leading-none text-[var(--aurum-text)]"
          style={{ fontFamily: "var(--aurum-font-display)", fontWeight: 500 }}
        >
          Sign in
        </h1>
        <p className="mt-3 text-[14px] text-[var(--aurum-text-muted)]">
          Private access to your executive assistant.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />
        {error ? (
          <p className="text-[13px] text-[var(--aurum-danger)]" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading}
          style={{ width: "100%" }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-[13px] text-[var(--aurum-text-dim)]">
        No account?{" "}
        <Link href="/signup" className="text-[var(--aurum-gold)]">
          Create one
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] tracking-[0.1em] uppercase text-[var(--aurum-text-dim)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="aurum-focus-ring w-full rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border-strong)] bg-[var(--aurum-graphite)] px-3 py-2.5 text-[14px] text-[var(--aurum-text)] outline-none"
      />
    </label>
  );
}
