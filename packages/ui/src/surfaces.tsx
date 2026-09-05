import type { ReactNode } from "react";

export interface SurfaceFrameProps {
  kicker: string;
  title?: string;
  status?: string;
  children: ReactNode;
  /** Cards are for approvals / previews — lists use plain typography. */
  variant?: "plain" | "card";
}

export function SurfaceFrame({
  kicker,
  title,
  status,
  children,
  variant = "plain",
}: SurfaceFrameProps) {
  return (
    <section
      className={
        variant === "card"
          ? "aurum-panel-enter aurum-surface p-5"
          : "aurum-panel-enter"
      }
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[12px] tracking-[0.14em] uppercase text-[var(--aurum-text-dim)]">
            {kicker}
          </div>
          {title ? (
            <h2 className="mt-1.5 text-[15px] font-medium text-[var(--aurum-text)]">
              {title}
            </h2>
          ) : null}
        </div>
        {status ? (
          <span className="text-[12px] text-[var(--aurum-text-dim)]">
            {status}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Unavailable({ label, detail }: { label: string; detail: string }) {
  return (
    <p className="text-[14px] leading-relaxed text-[var(--aurum-text-muted)]">
      {detail ? (
        <>
          {label ? (
            <span className="block text-[13px] text-[var(--aurum-text)]">
              {label}
            </span>
          ) : null}
          <span className="mt-1 block text-[13px] text-[var(--aurum-text-dim)]">
            {detail}
          </span>
        </>
      ) : (
        label
      )}
    </p>
  );
}

export interface TaskSurfaceProps {
  connected?: boolean;
  tasks?: ReadonlyArray<{
    id: string;
    title: string;
    due?: string;
    status?: string;
    priority?: string;
    /** Aurum-built href only — when set, row is a link */
    href?: string;
  }>;
  emptyLabel?: string;
  emptyDetail?: string;
  statusLabel?: string;
}

export function TaskSurface({
  connected = false,
  tasks,
  emptyLabel = "No tasks",
  emptyDetail = "Nothing is waiting.",
  statusLabel,
}: TaskSurfaceProps) {
  const list = connected ? (tasks ?? []) : [];
  return (
    <SurfaceFrame
      kicker="Tasks"
      status={
        statusLabel ??
        (connected ? `${list.length} open` : "Not connected")
      }
    >
      {!connected ? (
        <Unavailable
          label="Task system"
          detail="Task controls appear here once the tool engine is connected. Nothing is invented in the meantime."
        />
      ) : list.length === 0 ? (
        <Unavailable label={emptyLabel} detail={emptyDetail} />
      ) : (
        <ul className="space-y-0">
          {list.map((task) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1 text-[15px] text-[var(--aurum-text)]">
                  {task.title}
                  {task.status === "COMPLETED" ? (
                    <span className="ml-2 text-[12px] text-[var(--aurum-text-dim)]">
                      Done
                    </span>
                  ) : null}
                </span>
                {task.due ? (
                  <span className="shrink-0 text-[13px] text-[var(--aurum-text-dim)]">
                    {task.due}
                  </span>
                ) : task.priority && task.priority !== "NORMAL" ? (
                  <span className="shrink-0 text-[13px] text-[var(--aurum-text-dim)]">
                    {task.priority === "HIGH" ? "High" : task.priority}
                  </span>
                ) : null}
              </>
            );
            return (
              <li
                key={task.id}
                className="border-b border-[var(--aurum-border)] py-4 last:border-0"
              >
                {task.href ? (
                  <a
                    href={task.href}
                    className="aurum-focus-ring flex w-full items-baseline justify-between gap-3 rounded-sm text-left hover:text-[var(--aurum-gold)]"
                  >
                    {inner}
                  </a>
                ) : (
                  <div className="flex items-baseline justify-between gap-3">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SurfaceFrame>
  );
}

export interface ScheduleSurfaceProps {
  connected?: boolean;
  nextEvent?: { title: string; when: string } | null;
}

export function ScheduleSurface({
  connected = false,
  nextEvent,
}: ScheduleSurfaceProps) {
  return (
    <SurfaceFrame
      kicker="Schedule"
      status={connected ? "Live" : "Not connected"}
    >
      {!connected ? (
        <Unavailable
          label="Calendar"
          detail="Google Calendar is not connected. No events are shown."
        />
      ) : nextEvent ? (
        <div>
          <div className="text-[11px] tracking-[0.12em] uppercase text-[var(--aurum-text-dim)]">
            Next event
          </div>
          <div className="mt-1 text-[14px] text-[var(--aurum-text)]">
            {nextEvent.title}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--aurum-text-muted)]">
            {nextEvent.when}
          </div>
        </div>
      ) : (
        <Unavailable label="No upcoming events" detail="The calendar is clear." />
      )}
    </SurfaceFrame>
  );
}

export interface ClientSurfaceProps {
  connected?: boolean;
  client?: { name: string; summary?: string } | null;
}

export function ClientSurface({
  connected = false,
  client,
}: ClientSurfaceProps) {
  return (
    <SurfaceFrame
      kicker="Client"
      title={connected ? client?.name : undefined}
      status={connected ? "Intelligence" : "Not connected"}
    >
      {!connected ? (
        <Unavailable
          label="CRM"
          detail="Client intelligence surfaces here when contacts are connected. No placeholder people."
        />
      ) : client ? (
        <p className="text-[13px] leading-relaxed text-[var(--aurum-text-muted)]">
          {client.summary ?? "No notes yet."}
        </p>
      ) : (
        <Unavailable
          label="No client selected"
          detail="Ask Aurum for a specific contact once CRM is live."
        />
      )}
    </SurfaceFrame>
  );
}

export interface BusinessSurfaceProps {
  connected?: boolean;
}

export function BusinessSurface({ connected = false }: BusinessSurfaceProps) {
  return (
    <SurfaceFrame
      kicker="Business"
      status={connected ? "Live" : "Not connected"}
    >
      {!connected ? (
        <Unavailable
          label="Pipeline"
          detail="Business intelligence is reserved until CRM and leads are connected. No fake metrics."
        />
      ) : (
        <Unavailable label="No data" detail="Nothing to report yet." />
      )}
    </SurfaceFrame>
  );
}

export interface FileSurfaceProps {
  connected?: boolean;
  files?: ReadonlyArray<{
    id: string;
    name: string;
    relativePath?: string;
    kind?: string;
    href?: string;
  }>;
}

export function FileSurface({ connected = false, files }: FileSurfaceProps) {
  const list = connected ? (files ?? []) : [];
  return (
    <SurfaceFrame
      kicker="Files"
      status={connected ? `${list.length} found` : "Desktop"}
    >
      {!connected ? (
        <Unavailable
          label="Local files"
          detail="Desktop file tools run only inside approved folders on the Windows companion."
        />
      ) : list.length === 0 ? (
        <Unavailable label="No results" detail="Nothing matched." />
      ) : (
        <ul className="space-y-2">
          {list.map((file) => {
            const body = (
              <>
                <div className="text-[13px] text-[var(--aurum-text)]">
                  {file.name}
                </div>
                {file.relativePath ? (
                  <div className="mt-0.5 text-[11px] text-[var(--aurum-text-dim)]">
                    {file.relativePath}
                    {file.kind ? ` · ${file.kind}` : ""}
                  </div>
                ) : null}
              </>
            );
            return (
              <li
                key={file.id}
                className="border-b border-[var(--aurum-border)] py-2 last:border-0"
              >
                {file.href ? (
                  <a
                    href={file.href}
                    className="aurum-focus-ring block rounded-sm hover:opacity-90"
                  >
                    {body}
                  </a>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SurfaceFrame>
  );
}

export interface MemorySurfaceProps {
  connected?: boolean;
}

export function MemorySurface({ connected = false }: MemorySurfaceProps) {
  return (
    <SurfaceFrame
      kicker="Memory"
      status={connected ? "Ready" : "Not configured"}
    >
      {!connected ? (
        <Unavailable
          label="Long-term memory"
          detail="Structured memory is not configured. Conversation context still persists for this session."
        />
      ) : (
        <Unavailable label="No memories" detail="Nothing stored yet." />
      )}
    </SurfaceFrame>
  );
}

export interface ApprovalSurfaceProps {
  pending?: boolean;
}

export function ApprovalSurface({ pending = false }: ApprovalSurfaceProps) {
  return (
    <SurfaceFrame
      kicker="Approval"
      status={pending ? "Waiting" : "Idle"}
      variant="card"
    >
      <Unavailable
        label={pending ? "Awaiting confirmation" : "No pending approvals"}
        detail="Actions that change your system will pause here until you confirm them."
      />
    </SurfaceFrame>
  );
}

export interface SearchResultsSurfaceProps {
  query?: string;
  connected?: boolean;
  results?: ReadonlyArray<{
    id: string;
    title?: string | null;
    snippet: string;
    href?: string;
  }>;
}

export function SearchResultsSurface({
  query,
  connected = false,
  results,
}: SearchResultsSurfaceProps) {
  const list = connected ? (results ?? []) : [];
  return (
    <SurfaceFrame
      kicker="Notes"
      title={query || undefined}
      status={connected ? `${list.length} found` : "Limited"}
    >
      {!connected ? (
        <Unavailable
          label={query ? `No indexed results for “${query}”` : "No results"}
          detail="System-wide search is not connected yet. History remains available from the drawer."
        />
      ) : list.length === 0 ? (
        <Unavailable
          label={query ? `Nothing matched “${query}”` : "No results"}
          detail="No notes matched that search."
        />
      ) : (
        <ul className="space-y-3">
          {list.map((item) => {
            const body = (
              <>
                {item.title ? (
                  <div className="text-[13px] font-medium text-[var(--aurum-text)]">
                    {item.title}
                  </div>
                ) : null}
                <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--aurum-text-muted)]">
                  {item.snippet}
                </p>
              </>
            );
            return (
              <li
                key={item.id}
                className="border-b border-[var(--aurum-border)] pb-3 last:border-0"
              >
                {item.href ? (
                  <a
                    href={item.href}
                    className="aurum-focus-ring block rounded-sm hover:opacity-90"
                  >
                    {body}
                  </a>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SurfaceFrame>
  );
}
