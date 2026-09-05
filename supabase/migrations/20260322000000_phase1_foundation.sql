-- Aurum Phase 1 foundation schema
-- Apply in Supabase SQL editor or via `supabase db push`
-- All user-owned tables use RLS. Never rely on client-side security alone.

-- Extensions
create extension if not exists "pgcrypto";
-- vector for memory embeddings (Phase 6); safe to enable early
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  assistant_name text not null default 'Aurum',
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_type text not null check (device_type in ('WINDOWS_DESKTOP', 'WEB', 'IPHONE_PWA', 'ANDROID_PWA', 'UNKNOWN')),
  name text not null,
  last_seen_at timestamptz,
  is_online boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists devices_user_id_idx on public.devices (user_id);
alter table public.devices enable row level security;

create policy "devices_all_own"
  on public.devices for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- conversations / messages
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  device_id uuid references public.devices (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx on public.conversations (user_id);
alter table public.conversations enable row level security;

create policy "conversations_all_own"
  on public.conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  tool_name text,
  tool_call_id text,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
alter table public.messages enable row level security;

create policy "messages_all_own"
  on public.messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'TODO'
    check (status in ('TODO', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED')),
  priority text not null default 'NORMAL'
    check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  due_date date,
  due_time time,
  project text,
  tags text[] not null default '{}',
  source text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);
alter table public.tasks enable row level security;

create policy "tasks_all_own"
  on public.tasks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_id_idx on public.notes (user_id);
alter table public.notes enable row level security;

create policy "notes_all_own"
  on public.notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  category text not null default 'GENERAL'
    check (category in ('PERSONAL_PREFERENCE', 'BUSINESS', 'PERSON', 'PROJECT', 'WORKFLOW', 'GENERAL')),
  importance int not null default 5 check (importance between 1 and 10),
  source text,
  is_active boolean not null default true,
  embedding vector(1536),
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_id_idx on public.memories (user_id);
alter table public.memories enable row level security;

create policy "memories_all_own"
  on public.memories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- approvals
-- ---------------------------------------------------------------------------
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  tool_id text not null,
  action_label text not null,
  parameters jsonb not null default '{}',
  permission_level text not null
    check (permission_level in ('READ', 'SAFE_WRITE', 'CONFIRM', 'RESTRICTED')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'FAILED')),
  result jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists approvals_user_id_idx on public.approvals (user_id);
alter table public.approvals enable row level security;

create policy "approvals_all_own"
  on public.approvals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- activity_log (audit)
-- ---------------------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  tool_id text,
  permission_level text
    check (permission_level is null or permission_level in ('READ', 'SAFE_WRITE', 'CONFIRM', 'RESTRICTED')),
  arguments_safe jsonb,
  result_summary text,
  error text,
  approval_id uuid references public.approvals (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_user_id_idx on public.activity_log (user_id);
alter table public.activity_log enable row level security;

create policy "activity_log_select_own"
  on public.activity_log for select
  using (auth.uid() = user_id);

create policy "activity_log_insert_own"
  on public.activity_log for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- business foundations (Phase 10 tables created early for schema stability)
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;
create policy "companies_all_own" on public.companies for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  name text not null,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contacts enable row level security;
create policy "contacts_all_own" on public.contacts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  company text,
  phone text,
  email text,
  status text not null default 'NEW'
    check (status in ('NEW', 'CONTACTED', 'INTERESTED', 'DEMO', 'PROPOSAL', 'WON', 'LOST')),
  source text,
  estimated_value numeric,
  notes text,
  next_follow_up timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;
create policy "leads_all_own" on public.leads for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- automations (Phase 11)
-- ---------------------------------------------------------------------------
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  trigger text not null,
  schedule text,
  action jsonb not null default '{}',
  last_run timestamptz,
  next_run timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automations enable row level security;
create policy "automations_all_own" on public.automations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- integrations placeholder
-- ---------------------------------------------------------------------------
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.integrations enable row level security;
create policy "integrations_all_own" on public.integrations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
