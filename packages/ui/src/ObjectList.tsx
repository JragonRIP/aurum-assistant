import type { ReactNode } from "react";

export type ObjectListItem = {
  id: string;
  title: string;
  meta?: string;
  href?: string;
  trailing?: string;
};

export function ObjectList({
  items,
  empty,
  emptyDetail,
}: {
  items: readonly ObjectListItem[];
  empty?: string;
  emptyDetail?: string;
}) {
  if (items.length === 0) {
    return (
      <div>
        {empty ? (
          <p className="text-[15px] text-[var(--aurum-text-muted)]">{empty}</p>
        ) : null}
        {emptyDetail ? (
          <p className="mt-1 text-[13px] text-[var(--aurum-text-dim)]">
            {emptyDetail}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ul>
      {items.map((item) => {
        const body = (
          <>
            <span className="min-w-0">
              <span className="block text-[15px] text-[var(--aurum-text)]">
                {item.title}
              </span>
              {item.meta ? (
                <span className="mt-1 block text-[13px] text-[var(--aurum-text-dim)]">
                  {item.meta}
                </span>
              ) : null}
            </span>
            {item.trailing ? (
              <span className="shrink-0 text-[12px] text-[var(--aurum-text-dim)]">
                {item.trailing}
              </span>
            ) : null}
          </>
        );

        return (
          <li
            key={item.id}
            className="border-b border-[var(--aurum-border)] py-4 last:border-0"
          >
            {item.href ? (
              <a
                href={item.href}
                className="aurum-focus-ring flex w-full items-baseline justify-between gap-6 rounded-sm hover:text-[var(--aurum-gold)]"
              >
                {body}
              </a>
            ) : (
              <div className="flex items-baseline justify-between gap-6">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ObjectSection({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="aurum-panel-enter">
      <header className="mb-1 flex items-baseline justify-between gap-4">
        <h2 className="text-[12px] tracking-[0.14em] text-[var(--aurum-text-dim)] uppercase">
          {label}
        </h2>
        {typeof count === "number" ? (
          <span className="text-[12px] text-[var(--aurum-text-dim)]">
            {count}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
