-- Phase 3: tool engine audit (tool_runs) + approval generation linkage
-- Does NOT modify Phase 1/2 migrations.
-- Tasks/notes/approvals/activity_log already exist from Phase 1.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- tool_runs — auditable tool execution log with idempotency keys
-- ---------------------------------------------------------------------------
create table if not exists public.tool_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  generation_id uuid,
  execution_id text not null,
  tool_name text not null,
  permission_level text not null
    check (permission_level in ('READ', 'SAFE_WRITE', 'CONFIRM', 'RESTRICTED')),
  status text not null default 'requested'
    check (status in (
      'requested',
      'validating',
      'waiting_for_approval',
      'executing',
      'succeeded',
      'failed',
      'rejected',
      'cancelled'
    )),
  sanitized_input jsonb not null default '{}',
  result_summary text,
  error_code text,
  error_message text,
  approval_id uuid references public.approvals (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms int,
  created_at timestamptz not null default now()
);

create unique index if not exists tool_runs_user_execution_uidx
  on public.tool_runs (user_id, execution_id);

create index if not exists tool_runs_user_id_idx on public.tool_runs (user_id);
create index if not exists tool_runs_generation_id_idx on public.tool_runs (generation_id);
create index if not exists tool_runs_conversation_id_idx on public.tool_runs (conversation_id);

alter table public.tool_runs enable row level security;

create policy "tool_runs_select_own"
  on public.tool_runs for select
  using (auth.uid() = user_id);

create policy "tool_runs_insert_own"
  on public.tool_runs for insert
  with check (auth.uid() = user_id);

create policy "tool_runs_update_own"
  on public.tool_runs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- approvals — link to generation + tool execution for Phase 3+ CONFIRM tools
-- ---------------------------------------------------------------------------
alter table public.approvals
  add column if not exists generation_id uuid;

alter table public.approvals
  add column if not exists execution_id text;

create index if not exists approvals_generation_id_idx
  on public.approvals (generation_id);

-- ---------------------------------------------------------------------------
-- notes — text search indexes
-- ---------------------------------------------------------------------------
create index if not exists notes_content_trgm_idx
  on public.notes using gin (content gin_trgm_ops);

create index if not exists notes_title_trgm_idx
  on public.notes using gin ((coalesce(title, '')) gin_trgm_ops);

create index if not exists tasks_user_status_idx
  on public.tasks (user_id, status);

create index if not exists tasks_user_due_date_idx
  on public.tasks (user_id, due_date);
