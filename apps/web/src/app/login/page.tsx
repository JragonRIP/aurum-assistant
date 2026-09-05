import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasSupabaseConfig } from "@/lib/env";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  if (!hasSupabaseConfig()) {
    redirect("/setup");
  }

  return (
    <Suspense fallback={<div className="p-8 text-[var(--aurum-text-muted)]">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
