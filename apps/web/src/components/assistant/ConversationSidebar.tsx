"use client";

import { useState } from "react";
import type { UiConversation } from "./types";
import { groupConversationsByDate } from "./types";
import { Button } from "@aurum/ui";

interface ConversationSidebarProps {
  conversations: UiConversation[];
  selectedId: string | null;
  loading?: boolean;
  hideChrome?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => void;
}

export function ConversationSidebar({
  conversations,
  selectedId,
  loading,
  hideChrome,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: ConversationSidebarProps) {
  const groups = groupConversationsByDate(conversations);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  async function commitRename(id: string) {
    const next = editValue.trim();
    setEditingId(null);
    if (!next) return;
    await onRename(id, next);
  }

  return (
    <div className="flex h-full w-full flex-col">
      {hideChrome ? null : (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--aurum-border)] px-3 py-3">
          <span
            className="text-[11px] tracking-[0.16em] uppercase text-[var(--aurum-text-dim)]"
            style={{ fontFamily: "var(--aurum-font-body)" }}
          >
            History
          </span>
          <Button variant="ghost" size="sm" onClick={onNew} disabled={loading}>
            New session
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-[13px] text-[var(--aurum-text-dim)]">
            No conversations yet.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="mb-1.5 px-2 text-[10px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.conversations.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id} className="relative">
                      {editingId === c.id ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => void commitRename(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitRename(c.id);
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="w-full rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-gold)] bg-[var(--aurum-graphite)] px-2.5 py-2 text-[13px] text-[var(--aurum-text)] outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelect(c.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenuId(c.id);
                          }}
                          className="aurum-focus-ring flex w-full items-center justify-between gap-2 rounded-[var(--aurum-radius-sm)] px-2.5 py-2 text-left text-[13px] transition-colors"
                          style={{
                            background: active
                              ? "var(--aurum-gold-soft)"
                              : "transparent",
                            color: active
                              ? "var(--aurum-gold-bright)"
                              : "var(--aurum-text-muted)",
                            border: active
                              ? "1px solid rgba(196, 165, 116, 0.22)"
                              : "1px solid transparent",
                          }}
                        >
                          <span className="truncate">
                            {c.title || "New conversation"}
                          </span>
                          <span
                            role="presentation"
                            className="shrink-0 text-[11px] text-[var(--aurum-text-dim)] opacity-70"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuId(menuId === c.id ? null : c.id);
                            }}
                          >
                            ···
                          </span>
                        </button>
                      )}

                      {menuId === c.id ? (
                        <div className="absolute right-1 top-9 z-20 min-w-[140px] rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border-strong)] bg-[var(--aurum-surface)] py-1 shadow-[var(--aurum-shadow-soft)]">
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--aurum-text-muted)] hover:bg-[var(--aurum-charcoal)]"
                            onClick={() => {
                              setMenuId(null);
                              setEditingId(c.id);
                              setEditValue(c.title || "");
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--aurum-danger)] hover:bg-[var(--aurum-charcoal)]"
                            onClick={() => {
                              setMenuId(null);
                              onDelete(c.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
