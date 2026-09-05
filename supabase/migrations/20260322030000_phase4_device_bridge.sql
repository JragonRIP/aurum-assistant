-- Phase 4: Windows device bridge — pairing, credentials, approved roots, requests
-- Do not edit prior migrations.

-- ---------------------------------------------------------------------------
-- Extend devices
-- ---------------------------------------------------------------------------
alter table public.devices
  add column if not exists platform text,
  add column if not exists os_version text,
  add column if not exists app_version text,
  add column if not exists status text not null default 'offline'
    check (status in ('online', 'offline', 'connecting', 'disabled')),
  add column if not exists credential_hash text,
  add column if not exists is_default boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Keep is_online in sync with status for existing health UI
create or replace function public.sync_device_online_flag()
returns trigger
language plpgsql
as $$
begin
  new.is_online := (new.status = 'online');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists devices_sync_online on public.devices;
create trigger devices_sync_online
  before insert or update of status on public.devices
  for each row execute function public.sync_device_online_flag();

create index if not exists devices_user_status_idx
  on public.devices (user_id, status);

-- ---------------------------------------------------------------------------
-- Pairing tokens (store hash only)
-- ---------------------------------------------------------------------------
create table if not exists public.device_pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  code_hint text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists device_pairing_tokens_user_idx
  on public.device_pairing_tokens (user_id);

create index if not exists device_pairing_tokens_expires_idx
  on public.device_pairing_tokens (expires_at);

alter table public.device_pairing_tokens enable row level security;

create policy "device_pairing_tokens_own"
  on public.device_pairing_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Approved filesystem roots per device
-- ---------------------------------------------------------------------------
create table if not exists public.device_approved_roots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  label text not null,
  canonical_path text not null,
  created_at timestamptz not null default now(),
  unique (device_id, canonical_path)
);

create index if not exists device_approved_roots_device_idx
  on public.device_approved_roots (device_id);

alter table public.device_approved_roots enable row level security;

create policy "device_approved_roots_own"
  on public.device_approved_roots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Device tool requests (request/response correlation)
-- ---------------------------------------------------------------------------
create table if not exists public.device_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  request_id text not null,
  execution_id text not null,
  tool_name text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'expired', 'cancelled')),
  result jsonb,
  error_code text,
  error_message text,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (device_id, execution_id),
  unique (device_id, request_id)
);

create index if not exists device_requests_pending_idx
  on public.device_requests (device_id, status, expires_at)
  where status = 'pending';

create index if not exists device_requests_user_idx
  on public.device_requests (user_id);

alter table public.device_requests enable row level security;

create policy "device_requests_own"
  on public.device_requests for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service-role / bridge routes use the authenticated user JWT or device
-- verification in application code. Device bridge APIs use the device
-- credential and service-scoped queries; RLS still protects browser clients.
