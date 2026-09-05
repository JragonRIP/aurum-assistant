export type ActionStatusState = "pending" | "success" | "error";

export interface ActionStatusProps {
  label: string;
  detail?: string;
  state: ActionStatusState;
  /** When set, the row is an accessible link to the underlying object */
  href?: string;
}

/**
 * Compact live action feedback. Successful actions should not become paragraphs.
 */
export function ActionStatus({ label, detail, state, href }: ActionStatusProps) {
  const content = (
    <>
      <div>
        <div
          className="text-[11px] tracking-[0.16em] uppercase"
          style={{
            color:
              state === "error"
                ? "var(--aurum-danger)"
                : state === "success"
                  ? "var(--aurum-gold)"
                  : "var(--aurum-text-muted)",
            fontFamily: "var(--aurum-font-body)",
          }}
        >
          {state === "success" ? `✓ ${label}` : label}
        </div>
        {detail ? (
          <div className="mt-1 text-[12px] text-[var(--aurum-text-dim)]">
            {detail}
          </div>
        ) : null}
      </div>
      {state === "pending" ? (
        <span className="mt-1 inline-flex gap-1" aria-hidden>
          <span className="aurum-action-dot" />
          <span className="aurum-action-dot" />
          <span className="aurum-action-dot" />
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="aurum-panel-enter aurum-focus-ring flex items-start justify-between gap-4 rounded-sm py-2 hover:opacity-90"
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className="aurum-panel-enter flex items-start justify-between gap-4 py-2"
      role="status"
    >
      {content}
    </div>
  );
}

export interface NativeErrorProps {
  title: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function NativeError({
  title,
  onRetry,
  retryLabel = "Retry",
}: NativeErrorProps) {
  return (
    <div className="aurum-native-error" role="alert">
      <span>{title}</span>
      {onRetry ? (
        <button
          type="button"
          className="aurum-focus-ring tracking-[0.14em] uppercase text-[var(--aurum-gold)]"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
