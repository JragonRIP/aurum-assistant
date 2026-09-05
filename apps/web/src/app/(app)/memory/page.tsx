import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

export default function MemoryPage() {
  return (
    <WorkspaceScreen kicker="System" title="Memory">
      <p className="text-[15px] text-[var(--aurum-text-muted)]">
        Long-term memory is not configured.
      </p>
    </WorkspaceScreen>
  );
}
