"use client";

import {
  useEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const FOCUS_COMMAND_EVENT = "aurum:focus-command";

function isCommandHotkey(e: { ctrlKey: boolean; metaKey: boolean; key: string }) {
  return (e.ctrlKey || e.metaKey) && e.key === " ";
}

export interface CommandBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  streaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
  aiConfigured?: boolean;
  voiceSlot?: ReactNode;
  /** When false, this instance does not steal Ctrl+Space. Default true. */
  captureHotkey?: boolean;
}

/**
 * Command interface — not a chatbot composer.
 * Enter submits. Esc cancels/stops. Ctrl+Space focuses from anywhere in Aurum.
 */
export function CommandBar({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled,
  streaming,
  onStop,
  placeholder = "What do you need?",
  hint = "Ctrl + Space",
  autoFocus,
  aiConfigured = true,
  voiceSlot,
  captureHotkey = true,
}: CommandBarProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    function focusField() {
      ref.current?.focus();
    }

    function onFocusEvent() {
      focusField();
    }

    function onGlobal(e: globalThis.KeyboardEvent) {
      if (!captureHotkey || !isCommandHotkey(e)) return;
      if (ref.current && document.activeElement === ref.current) return;
      e.preventDefault();
      focusField();
    }

    window.addEventListener(FOCUS_COMMAND_EVENT, onFocusEvent);
    window.addEventListener("keydown", onGlobal);
    return () => {
      window.removeEventListener(FOCUS_COMMAND_EVENT, onFocusEvent);
      window.removeEventListener("keydown", onGlobal);
    };
  }, [captureHotkey]);

  const unavailable = disabled || !aiConfigured;

  function submit() {
    const text = value.trim();
    if (!text || unavailable || streaming) return;
    onSubmit(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (streaming) onStop?.();
      else onCancel?.();
    }
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  const shownHint = streaming ? "Esc to stop" : hint;
  const shownPlaceholder = aiConfigured ? placeholder : "AI offline";

  return (
    <form
      onSubmit={onFormSubmit}
      className="aurum-command aurum-transition flex items-end gap-4 border-b border-[var(--aurum-border)] pb-3"
    >
      <input
        ref={ref}
        id="aurum-command-field"
        value={value}
        disabled={unavailable}
        placeholder={shownPlaceholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="What do you need?"
        className="min-w-0 flex-1 bg-transparent py-1 text-[16px] text-[var(--aurum-text)] outline-none placeholder:text-[var(--aurum-text-dim)] disabled:opacity-50 md:text-[17px]"
      />
      {voiceSlot}
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          className="aurum-focus-ring shrink-0 pb-1 text-[12px] text-[var(--aurum-text-muted)]"
        >
          Stop
        </button>
      ) : null}
      <span
        className="hidden shrink-0 pb-1 text-[11px] text-[var(--aurum-text-dim)] lg:inline"
        aria-hidden
      >
        {shownHint}
      </span>
    </form>
  );
}
