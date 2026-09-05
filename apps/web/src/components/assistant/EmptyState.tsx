"use client";

import { greetingForNow } from "./types";

interface AssistantEmptyStateProps {
  disabled?: boolean;
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  "What should I focus on today?",
  "Summarize my priorities for this week.",
  "Help me draft a short executive update.",
];

export function AssistantEmptyState({
  disabled,
  onSuggestion,
}: AssistantEmptyStateProps) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-10">
      <p
        className="text-[28px] text-[var(--aurum-text)]"
        style={{ fontFamily: "var(--aurum-font-display)", fontWeight: 500 }}
      >
        {greetingForNow()}
      </p>
      <p className="mt-2 text-[14px] text-[var(--aurum-text-muted)]">
        Ask Aurum anything. This is your private executive assistant.
      </p>
      <div className="mt-8 flex flex-col gap-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            disabled={disabled}
            onClick={() => onSuggestion(text)}
            className="rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border)] bg-[var(--aurum-graphite)] px-4 py-3 text-left text-[13px] text-[var(--aurum-text)] transition hover:border-[var(--aurum-border-strong)] disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
