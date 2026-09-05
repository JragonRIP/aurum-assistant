import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

export default function ClientsPage() {
  return (
    <WorkspaceScreen kicker="Business" title="Clients">
      <p className="text-[15px] text-[var(--aurum-text-muted)]">
        No clients connected.
      </p>
    </WorkspaceScreen>
  );
}
