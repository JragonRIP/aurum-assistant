"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@aurum/ui";
import type { UiMessage } from "./types";

interface MessageBubbleProps {
  message: UiMessage;
  onRetry?: () => void;
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const showRetry =
    !isUser &&
    (message.status === "error" || message.metadata?.failed === true) &&
    onRetry;

  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className="max-w-[min(720px,92%)] rounded-[var(--aurum-radius-md)] px-4 py-3"
        style={{
          background: isUser
            ? "var(--aurum-charcoal)"
            : "var(--aurum-graphite)",
          border: isUser
            ? "1px solid var(--aurum-border-strong)"
            : "1px solid var(--aurum-border)",
        }}
      >
        {!isUser ? (
          <div className="mb-1.5 text-[10px] tracking-[0.16em] uppercase text-[var(--aurum-gold)]">
            Aurum
            {message.streaming && !message.content ? " · thinking" : null}
            {message.streaming && message.content ? " · responding" : null}
            {message.status === "partial" ? " · stopped" : null}
            {message.status === "error" ? " · error" : null}
          </div>
        ) : null}

        {isUser ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--aurum-text)]">
            {message.content}
          </p>
        ) : (
          <MarkdownBody
            content={message.content || (message.streaming ? "…" : "")}
          />
        )}

        {showRetry ? (
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="aurum-md text-[14px] leading-relaxed text-[var(--aurum-text)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--aurum-gold)] underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className);
            if (!isBlock) {
              return (
                <code
                  className="rounded px-1 py-0.5 text-[12.5px]"
                  style={{
                    background: "var(--aurum-elevated)",
                    fontFamily: "var(--aurum-font-mono)",
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          pre: ({ children }) => <>{children}</>,
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          h1: ({ children }) => (
            <h3
              className="mb-2 mt-3 text-[18px]"
              style={{ fontFamily: "var(--aurum-font-display)" }}
            >
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3
              className="mb-2 mt-3 text-[16px]"
              style={{ fontFamily: "var(--aurum-font-display)" }}
            >
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1.5 mt-2 text-[14px] font-medium">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => String(children).replace(/\n$/, ""), [children]);

  return (
    <div className="relative my-3 overflow-hidden rounded-[var(--aurum-radius-sm)] border border-[var(--aurum-border)] bg-[var(--aurum-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--aurum-border)] px-3 py-1.5">
        <span className="text-[10px] tracking-wider text-[var(--aurum-text-dim)]">
          {className?.replace("language-", "") || "code"}
        </span>
        <button
          type="button"
          className="text-[11px] text-[var(--aurum-text-muted)] hover:text-[var(--aurum-gold)]"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="overflow-x-auto p-3 text-[12.5px] leading-relaxed text-[var(--aurum-text)]"
        style={{ fontFamily: "var(--aurum-font-mono)" }}
      >
        <code>{text}</code>
      </pre>
    </div>
  );
}
