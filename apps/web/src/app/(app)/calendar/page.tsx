import Link from "next/link";
import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

export default function CalendarPage() {
  return (
    <WorkspaceScreen title="Calendar">
      <p className="text-[15px] text-[var(--aurum-text-muted)]">
        No calendar connected.
      </p>
      <Link
        href="/settings"
        className="aurum-focus-ring mt-3 inline-block text-[14px] text-[var(--aurum-gold)]"
      >
        Connect Google Calendar →
      </Link>
    </WorkspaceScreen>
  );
}
