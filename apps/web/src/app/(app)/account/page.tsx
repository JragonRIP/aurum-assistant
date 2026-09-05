import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/env";
import { SignOutButton } from "@/components/SignOutButton";

export default async function AccountPage() {
  if (!hasSupabaseConfig()) {
    return (
      <div className="px-8 py-10 md:px-14">
        <h1
          className="text-[28px] text-[var(--aurum-text)]"
          style={{ fontFamily: "var(--aurum-font-display)" }}
        >
          Account
        </h1>
        <p className="mt-3 text-[15px] text-[var(--aurum-text-muted)]">
          Supabase is not configured.
        </p>
        <Link
          href="/setup"
          className="aurum-focus-ring mt-4 inline-block text-[14px] text-[var(--aurum-gold)]"
        >
          Setup guide →
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10 md:px-14 md:py-14">
      <h1
        className="text-[28px] font-medium text-[var(--aurum-text)]"
        style={{ fontFamily: "var(--aurum-font-display)" }}
      >
        Account
      </h1>
      <dl className="mt-10 max-w-xl">
        <div className="border-b border-[var(--aurum-border)] py-4">
          <dt className="text-[12px] text-[var(--aurum-text-dim)]">Email</dt>
          <dd className="mt-1 text-[15px] text-[var(--aurum-text)]">
            {user?.email ?? "Not signed in"}
          </dd>
        </div>
        <div className="border-b border-[var(--aurum-border)] py-4">
          <dt className="text-[12px] text-[var(--aurum-text-dim)]">User ID</dt>
          <dd
            className="mt-1 break-all text-[12px] text-[var(--aurum-text-muted)]"
            style={{ fontFamily: "var(--aurum-font-mono)" }}
          >
            {user?.id ?? "—"}
          </dd>
        </div>
      </dl>
      {user ? (
        <div className="mt-8">
          <SignOutButton />
        </div>
      ) : null}
    </div>
  );
}
