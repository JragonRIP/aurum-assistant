import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

export default function FilesPage() {
  return (
    <WorkspaceScreen title="Files">
      <p className="text-[15px] text-[var(--aurum-text-muted)]">
        Desktop files are not connected.
      </p>
    </WorkspaceScreen>
  );
}
