import { AppShell } from "@/components/AppShell";
import { getSystemStatus } from "@/lib/system/status";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const status = await getSystemStatus();
  return <AppShell status={status}>{children}</AppShell>;
}
