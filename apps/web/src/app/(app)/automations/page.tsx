import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

export default function AutomationsPage() {
  return (
    <WorkspaceScreen kicker="System" title="Automations">
      <p className="text-[15px] text-[var(--aurum-text-muted)]">
        Automations are not active.
      </p>
    </WorkspaceScreen>
  );
}
