"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function CoreDeepLinkInner({
  apply,
}: {
  apply: (opts: {
    conversationId?: string | null;
    noteId?: string | null;
    query?: string | null;
  }) => Promise<void>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (pathname !== "/" && pathname !== "/core") return;
    const c = searchParams.get("c");
    const note = searchParams.get("note");
    const q = searchParams.get("q");
    if (!c && !note && !q) return;
    const key = `${c ?? ""}|${note ?? ""}|${q ?? ""}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    void apply({ conversationId: c, noteId: note, query: q });
  }, [pathname, searchParams, apply]);

  return null;
}

export function CoreDeepLinkBridge({
  apply,
}: {
  apply: (opts: {
    conversationId?: string | null;
    noteId?: string | null;
    query?: string | null;
  }) => Promise<void>;
}) {
  return (
    <Suspense fallback={null}>
      <CoreDeepLinkInner apply={apply} />
    </Suspense>
  );
}
