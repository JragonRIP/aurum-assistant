"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useRef } from "react";
import { Button } from "@aurum/ui";
import { useAurumSession } from "./useAurumSession";
import { HistoryDrawer } from "./HistoryDrawer";
import { ActivityDrawer } from "./ActivityDrawer";
import { CoreDeepLinkBridge } from "./CoreDeepLinkBridge";

type AurumContextValue = ReturnType<typeof useAurumSession> & {
  aiConfigured: boolean;
};

const AurumContext = createContext<AurumContextValue | null>(null);

export function AurumProvider({
  children,
  aiConfigured,
}: {
  children: React.ReactNode;
  aiConfigured: boolean;
}) {
  const session = useAurumSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const router = useRouter();
  const pathname = usePathname();
  const value: AurumContextValue = { ...session, aiConfigured };

  function goToCore() {
    if (pathname !== "/" && pathname !== "/core") router.push("/");
  }

  const applyDeepLink = useCallback(
    (opts: {
      conversationId?: string | null;
      noteId?: string | null;
      query?: string | null;
    }) => sessionRef.current.applyCoreDeepLink(opts),
    [],
  );

  return (
    <AurumContext.Provider value={value}>
      <CoreDeepLinkBridge apply={applyDeepLink} />
      {children}

      <ActivityDrawer
        open={session.activityOpen}
        items={session.activity}
        onClose={() => session.setActivityOpen(false)}
        onOpenSessions={() => {
          session.setActivityOpen(false);
          session.setHistoryOpen(true);
        }}
      />

      <HistoryDrawer
        open={session.historyOpen}
        conversations={session.conversations}
        selectedId={session.selectedId}
        loading={session.loadingList || session.streaming}
        error={session.historyError}
        onClose={() => session.setHistoryOpen(false)}
        onSelect={(id) => {
          router.push(`/?c=${encodeURIComponent(id)}`);
          void session.handleSelect(id);
        }}
        onNew={() => {
          goToCore();
          void session.handleNewSession();
        }}
        onRename={async (id, title) => {
          await session.handleRename(id, title);
        }}
        onDelete={(id) => {
          const c = session.conversations.find((x) => x.id === id) ?? null;
          session.setDeleteTarget(c);
        }}
        onRetry={() => void session.loadConversations()}
      />

      {session.deleteTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[var(--aurum-radius-md)] border border-[var(--aurum-border-strong)] bg-[var(--aurum-surface)] p-6 shadow-[var(--aurum-shadow-overlay)]">
            <h2 className="text-[16px] font-medium text-[var(--aurum-text)]">
              Delete this session?
            </h2>
            <p className="mt-2 text-[14px] text-[var(--aurum-text-muted)]">
              This permanently removes{" "}
              <strong className="text-[var(--aurum-text)]">
                {session.deleteTarget.title || "Untitled"}
              </strong>{" "}
              and its messages.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => session.setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void session.confirmDelete()}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AurumContext.Provider>
  );
}

export function useAurum(): AurumContextValue {
  const value = useContext(AurumContext);
  if (!value) {
    throw new Error("useAurum must be used within AurumProvider");
  }
  return value;
}
