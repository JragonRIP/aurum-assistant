"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@aurum/ui";

interface ComposerProps {
  disabled?: boolean;
  streaming?: boolean;
  aiConfigured: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({
  disabled,
  streaming,
  aiConfigured,
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled || streaming || !aiConfigured) return;
    onSend(text);
    setValue("");
  }

  return (
    <div className="border-t border-[var(--aurum-border)] px-4 py-3 md:px-6">
      {!aiConfigured ? (
        <p className="mb-2 text-[12px] text-[var(--aurum-warning)]">
          AI not configured — add GEMINI_API_KEY to apps/web/.env.local and
          restart.
        </p>
      ) : null}
      <div className="flex items-end gap-2 rounded-[var(--aurum-radius-md)] border border-[var(--aurum-border)] bg-[var(--aurum-graphite)] px-3 py-2">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled || !aiConfigured}
          placeholder={
            aiConfigured ? "Message Aurum…" : "AI not configured"
          }
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-[14px] text-[var(--aurum-text)] outline-none placeholder:text-[var(--aurum-text-dim)] disabled:opacity-50"
        />
        {streaming ? (
          <Button variant="secondary" size="sm" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={disabled || !aiConfigured || !value.trim()}
            onClick={submit}
          >
            Send
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--aurum-text-dim)]">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
