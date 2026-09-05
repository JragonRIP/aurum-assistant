import { redirect } from "next/navigation";
import { hasSupabaseConfig } from "@/lib/env";
import { SignupForm } from "@/components/SignupForm";

export default function SignupPage() {
  if (!hasSupabaseConfig()) {
    redirect("/setup");
  }

  return <SignupForm />;
}
