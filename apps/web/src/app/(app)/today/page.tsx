import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";
import { TodayWorkspace } from "@/components/tasks/TodayWorkspace";

export default function TodayPage() {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <WorkspaceScreen title="Today" aside={<span className="text-[14px] text-[var(--aurum-text-dim)]">{today}</span>}>
      <TodayWorkspace />
    </WorkspaceScreen>
  );
}
