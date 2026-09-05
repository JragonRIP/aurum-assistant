import { hasGeminiConfig, hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isDeviceHeartbeatFresh } from "@/lib/devices/queries";

export type DeviceSnapshot = {
  id: string;
  device_type: string;
  name: string;
  is_online: boolean;
  last_seen_at: string | null;
  status?: string;
};

export type SystemStatusSnapshot = {
  ai: "ONLINE" | "OFFLINE";
  memory: "READY" | "NOT CONFIGURED";
  desktop: "CONNECTED" | "NOT CONNECTED" | "OFFLINE";
  calendar: "CONNECTED" | "NOT CONNECTED";
  displayName: string | null;
  devices: DeviceSnapshot[];
};

export async function getSystemStatus(): Promise<SystemStatusSnapshot> {
  const snapshot: SystemStatusSnapshot = {
    ai: hasGeminiConfig() ? "ONLINE" : "OFFLINE",
    memory: "NOT CONFIGURED",
    desktop: "NOT CONNECTED",
    calendar: "NOT CONNECTED",
    displayName: null,
    devices: [],
  };

  if (!hasSupabaseConfig()) return snapshot;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return snapshot;

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.display_name && typeof profile.display_name === "string") {
      snapshot.displayName = profile.display_name;
    }

    const { data: devices, error } = await supabase
      .from("devices")
      .select("id, device_type, name, is_online, last_seen_at, status")
      .eq("user_id", user.id)
      .neq("status", "disabled")
      .order("last_seen_at", { ascending: false });

    if (!error && devices) {
      snapshot.devices = devices.map((d) => ({
        id: String(d.id),
        device_type: String(d.device_type),
        name: String(d.name),
        last_seen_at: (d.last_seen_at as string | null) ?? null,
        status: d.status ? String(d.status) : undefined,
        is_online: isDeviceHeartbeatFresh(d.last_seen_at as string | null),
      }));
      const windows = snapshot.devices.filter(
        (d) => d.device_type === "WINDOWS_DESKTOP",
      );
      if (windows.length === 0) {
        snapshot.desktop = "NOT CONNECTED";
      } else if (windows.some((d) => d.is_online)) {
        snapshot.desktop = "CONNECTED";
      } else {
        snapshot.desktop = "OFFLINE";
      }
    }
  } catch {
    // Keep honest defaults rather than fabricating status.
  }

  return snapshot;
}
