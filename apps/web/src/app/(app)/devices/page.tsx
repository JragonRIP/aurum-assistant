import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";
import { DevicesWorkspace } from "@/components/devices/DevicesWorkspace";

export default function DevicesPage() {
  return (
    <WorkspaceScreen title="Devices">
      <div className="xl:col-span-2">
        <DevicesWorkspace />
      </div>
    </WorkspaceScreen>
  );
}
