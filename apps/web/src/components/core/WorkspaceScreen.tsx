import type { ReactNode } from "react";

export function WorkspaceScreen({
  kicker,
  title,
  aside,
  children,
}: {
  kicker?: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-10 md:px-14 md:py-14">
      <header className="mb-12 flex max-w-2xl items-baseline justify-between gap-6">
        <div>
          {kicker ? (
            <div className="text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
              {kicker}
            </div>
          ) : null}
          <h1
            className="mt-2 text-[28px] font-medium leading-tight text-[var(--aurum-text)]"
            style={{ fontFamily: "var(--aurum-font-display)" }}
          >
            {title}
          </h1>
        </div>
        {aside}
      </header>
      <div className="max-w-2xl">{children}</div>
    </div>
  );
}
