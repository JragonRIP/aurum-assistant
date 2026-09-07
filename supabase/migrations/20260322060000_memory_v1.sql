-- Memory System v1: extend Phase 1 memories for structured LTM + vault sync.
-- Supabase remains canonical; Markdown vault is a derived representation.

-- New enums as check constraints (text) to match project conventions.

alter table public.memories
  add column if not exists title text,
  add column if not exists summary text,
  add column if not exists memory_type text,
  add column if not exists importance_level text,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists canonical_key text,
  add column if not exists subject_key text,
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists confidence numeric(4,3) not null default 0.800,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists supersedes_memory_id uuid references public.memories (id) on delete set null,
  add column if not exists superseded_by_memory_id uuid references public.memories (id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists vault_sync_status text not null default 'PENDING';

-- Backfill new columns from legacy fields
update public.memories
set
  memory_type = case category
    when 'PERSONAL_PREFERENCE' then 'PREFERENCE'
    when 'BUSINESS' then 'BUSINESS'
    when 'PERSON' then 'PERSON'
    when 'PROJECT' then 'PROJECT'
    when 'WORKFLOW' then 'ROUTINE'
    else 'FACT'
  end,
  importance_level = case
    when importance >= 9 then 'PINNED'
    when importance >= 7 then 'IMPORTANT'
    when importance <= 3 then 'TEMPORARY'
    else 'USEFUL'
  end,
  title = coalesce(title, left(content, 80)),
  source_type = coalesce(source_type, coalesce(source, 'SYSTEM_MIGRATED')),
  status = case when is_active then 'ACTIVE' else 'ARCHIVED' end
where memory_type is null;

alter table public.memories
  alter column memory_type set not null,
  alter column importance_level set not null,
  alter column title set not null;

alter table public.memories
  drop constraint if exists memories_memory_type_check;
alter table public.memories
  add constraint memories_memory_type_check check (
    memory_type in (
      'PROFILE', 'PREFERENCE', 'PERSON', 'BUSINESS', 'PROJECT', 'GOAL',
      'DECISION', 'ROUTINE', 'FACT', 'RELATIONSHIP', 'LOCATION', 'ASSET',
      'INTEREST', 'CONSTRAINT', 'REFERENCE', 'TEMPORARY'
    )
  );

alter table public.memories
  drop constraint if exists memories_importance_level_check;
alter table public.memories
  add constraint memories_importance_level_check check (
    importance_level in ('TEMPORARY', 'USEFUL', 'IMPORTANT', 'PINNED')
  );

alter table public.memories
  drop constraint if exists memories_status_check;
alter table public.memories
  add constraint memories_status_check check (
    status in ('ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'DELETED')
  );

alter table public.memories
  drop constraint if exists memories_source_type_check;
alter table public.memories
  add constraint memories_source_type_check check (
    source_type is null or source_type in (
      'USER_EXPLICIT', 'USER_CORRECTION', 'INFERRED_FROM_CONVERSATION',
      'SYSTEM_MIGRATED', 'MANUAL_EDIT'
    )
  );

alter table public.memories
  drop constraint if exists memories_vault_sync_status_check;
alter table public.memories
  add constraint memories_vault_sync_status_check check (
    vault_sync_status in ('SYNCED', 'PENDING', 'OFFLINE', 'ERROR', 'SKIPPED')
  );

alter table public.memories
  drop constraint if exists memories_confidence_check;
alter table public.memories
  add constraint memories_confidence_check check (
    confidence >= 0 and confidence <= 1
  );

-- One active memory per user+canonical_key
create unique index if not exists memories_user_canonical_active_uidx
  on public.memories (user_id, canonical_key)
  where status = 'ACTIVE' and canonical_key is not null;

create index if not exists memories_user_status_type_idx
  on public.memories (user_id, status, memory_type);

create index if not exists memories_user_canonical_idx
  on public.memories (user_id, canonical_key)
  where canonical_key is not null;

create index if not exists memories_user_valid_until_idx
  on public.memories (user_id, valid_until)
  where valid_until is not null and status = 'ACTIVE';

create index if not exists memories_content_trgm_idx
  on public.memories using gin (content gin_trgm_ops);

create index if not exists memories_title_trgm_idx
  on public.memories using gin (title gin_trgm_ops);

-- User settings for vault + memory toggles (lightweight; not a second memory store)
create table if not exists public.memory_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  vault_enabled boolean not null default false,
  vault_device_id uuid references public.devices (id) on delete set null,
  vault_root_label text,
  vault_root_path text,
  response_detail_preference text not null default 'concise'
    check (response_detail_preference in ('concise', 'balanced', 'detailed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.memory_settings enable row level security;

create policy "memory_settings_all_own"
  on public.memory_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Seed default response_detail preference as structured memory for existing users (idempotent)
insert into public.memories (
  user_id, title, content, category, importance, memory_type, importance_level,
  status, canonical_key, source_type, confidence, vault_sync_status, is_active
)
select
  p.id,
  'Response detail preference',
  'User prefers concise answers by default.',
  'PERSONAL_PREFERENCE',
  7,
  'PREFERENCE',
  'IMPORTANT',
  'ACTIVE',
  'preference:response_detail',
  'SYSTEM_MIGRATED',
  1.000,
  'SKIPPED',
  true
from public.profiles p
where not exists (
  select 1 from public.memories m
  where m.user_id = p.id
    and m.canonical_key = 'preference:response_detail'
    and m.status = 'ACTIVE'
);
