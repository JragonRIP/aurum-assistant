-- Aurum Phase 2 — text assistant metadata
-- Adds message completion status + AI usage tracking for cost visibility.

alter table public.messages
  add column if not exists status text not null default 'complete';

alter table public.messages
  drop constraint if exists messages_status_check;

alter table public.messages
  add constraint messages_status_check
  check (status in ('complete', 'partial', 'error'));

alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- ai_generations — non-sensitive usage metadata (model, tokens, latency)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  model text not null,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  status text not null default 'success'
    check (status in ('success', 'error', 'cancelled')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists ai_generations_user_id_idx
  on public.ai_generations (user_id);

create index if not exists ai_generations_conversation_id_idx
  on public.ai_generations (conversation_id);

alter table public.ai_generations enable row level security;

create policy "ai_generations_select_own"
  on public.ai_generations for select
  using (auth.uid() = user_id);

create policy "ai_generations_insert_own"
  on public.ai_generations for insert
  with check (auth.uid() = user_id);
