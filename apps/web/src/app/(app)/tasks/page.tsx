import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";
import { TasksWorkspace } from "@/components/tasks/TasksWorkspace";

export default function TasksPage() {
  return (
    <WorkspaceScreen title="Tasks">
      <TasksWorkspace />
    </WorkspaceScreen>
  );
}
