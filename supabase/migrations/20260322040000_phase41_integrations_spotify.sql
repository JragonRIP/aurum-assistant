-- Phase 4.1: Connected app integrations (Spotify first) + trusted references
-- Do not edit prior migrations.

-- Extend integrations placeholder from Phase 1
alter table public.integrations
  add column if not exists account_label text,
  add column if not exists external_account_id text,
  add column if not exists connected_at timestamptz,
  add column if not exists last_error text,
  add column if not exists scopes text[] not null default '{}';

alter table public.integrations
  drop constraint if exists integrations_status_check;

alter table public.integrations
  add constraint integrations_status_check
  check (status in ('disconnected', 'connected', 'reconnect_required', 'error'));

-- Encrypted OAuth tokens (service role writes; browser never sees plaintext)
create table if not exists public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  token_type text not null default 'Bearer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id)
);

create index if not exists integration_credentials_user_idx
  on public.integration_credentials (user_id);

alter table public.integration_credentials enable row level security;

-- No direct client access to credentials — only service role / server code
create policy "integration_credentials_deny_all"
  on public.integration_credentials for all
  using (false)
  with check (false);

-- Short-lived trusted provider references (tracks, devices) — model cannot invent these
create table if not exists public.integration_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  kind text not null check (kind in ('track', 'device', 'album', 'playlist')),
  provider_id text not null,
  provider_uri text not null,
  label text not null,
  subtitle text,
  payload jsonb not null default '{}'::jsonb,
  conversation_id uuid references public.conversations (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists integration_references_user_idx
  on public.integration_references (user_id, provider, kind);

create index if not exists integration_references_expires_idx
  on public.integration_references (expires_at);

alter table public.integration_references enable row level security;

create policy "integration_references_own"
  on public.integration_references for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- OAuth CSRF/PKCE state (short-lived)
create table if not exists public.integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  state text not null unique,
  code_verifier text not null,
  redirect_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists integration_oauth_states_expires_idx
  on public.integration_oauth_states (expires_at);

alter table public.integration_oauth_states enable row level security;

create policy "integration_oauth_states_own"
  on public.integration_oauth_states for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
