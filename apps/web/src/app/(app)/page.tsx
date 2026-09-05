import { hasGeminiConfig } from "@/lib/env";
import { getSystemStatus } from "@/lib/system/status";
import { AurumCore } from "@/components/core/AurumCore";

export default async function HomePage() {
  const aiConfigured = hasGeminiConfig();
  const status = await getSystemStatus();
  return <AurumCore aiConfigured={aiConfigured} status={status} />;
}
