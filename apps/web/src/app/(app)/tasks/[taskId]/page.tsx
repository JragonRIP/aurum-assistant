import { TaskDetailView } from "@/components/tasks/TaskDetailView";

type Params = { params: Promise<{ taskId: string }> };

export default async function TaskDetailPage({ params }: Params) {
  const { taskId } = await params;
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-8 py-10 md:px-14 md:py-14">
      <TaskDetailView taskId={taskId} />
    </div>
  );
}
