import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

export default function LeadsPage() {
  return (
    <WorkspaceScreen kicker="Business" title="Leads">
      <p className="text-[15px] text-[var(--aurum-text-muted)]">
        No leads connected.
      </p>
    </WorkspaceScreen>
  );
}
