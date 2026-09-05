"use client";

import { useRouter } from "next/navigation";
import { Button } from "@aurum/ui";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void signOut()}>
      Sign out
    </Button>
  );
}
