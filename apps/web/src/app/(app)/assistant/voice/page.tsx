import { AurumPresence, EmptyState } from "@aurum/ui";

/**
 * Deep-link target for iPhone Action Button / Shortcuts (Phase 8).
 * Opening this route will eventually prepare the voice interface immediately.
 */
export default function AssistantVoicePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-12">
      <AurumPresence state="OFFLINE" size="lg" />
      <p className="aurum-kicker mt-6">Voice</p>
      <h1 className="mt-3 text-[18px] font-medium text-[var(--aurum-text)]">
        Listening is not connected yet
      </h1>
      <div className="mt-6 max-w-md">
        <EmptyState
          title="Reserved"
          description="This route is reserved for /assistant/voice deep links. Realtime listening and speech arrive in Phase 5. The Core presence states already include LISTENING and SPEAKING for the future overlay."
        />
      </div>
    </div>
  );
}
