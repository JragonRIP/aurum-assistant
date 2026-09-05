"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export function AurumMarkdown({ content }: { content: string }) {
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
            <h3 className="mb-2 mt-3 text-[16px] font-medium">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-3 text-[15px] font-medium">{children}</h3>
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
