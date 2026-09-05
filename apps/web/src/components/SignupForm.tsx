"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@aurum/ui";
import { PRODUCT } from "@aurum/shared";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        router.push("/");
        router.refresh();
        return;
      }
      setMessage(
        "Check your email to confirm your account, then sign in. (If email confirmation is disabled in Supabase, you can sign in immediately.)",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
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
          Create account
        </h1>
        <p className="mt-3 text-[14px] text-[var(--aurum-text-muted)]">
          V1 is private — one user, shared across your devices.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[11px] tracking-[0.1em] uppercase text-[var(--aurum-text-dim)]">
            Email
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="aurum-focus-ring w-full rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border-strong)] bg-[var(--aurum-graphite)] px-3 py-2.5 text-[14px] text-[var(--aurum-text)] outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] tracking-[0.1em] uppercase text-[var(--aurum-text-dim)]">
            Password
          </span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="aurum-focus-ring w-full rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border-strong)] bg-[var(--aurum-graphite)] px-3 py-2.5 text-[14px] text-[var(--aurum-text)] outline-none"
          />
        </label>
        {error ? (
          <p className="text-[13px] text-[var(--aurum-danger)]" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="text-[13px] text-[var(--aurum-success)]" role="status">
            {message}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading}
          style={{ width: "100%" }}
        >
          {loading ? "Creating…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-[13px] text-[var(--aurum-text-dim)]">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--aurum-gold)]">
          Sign in
        </Link>
      </p>
    </div>
  );
}
