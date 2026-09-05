-- Music resolution preferences + short-lived disambiguation sessions
-- Persistent Spotify identity (provider id/uri), never temporary trusted-ref UUIDs.

create table if not exists public.music_resolution_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  intent_type text not null
    check (intent_type in ('track', 'playlist', 'album')),
  normalized_query text not null,
  spotify_resource_type text not null
    check (spotify_resource_type in ('track', 'playlist', 'album')),
  spotify_resource_id text not null,
  spotify_resource_uri text not null,
  track_name text,
  artist_name text,
  album_name text,
  playlist_name text,
  explicit boolean,
  source text not null
    check (source in ('INFERRED', 'USER_SELECTED', 'USER_EXPLICITLY_PREFERRED')),
  confidence real not null default 0.7
    check (confidence >= 0 and confidence <= 1),
  stale boolean not null default false,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, intent_type, normalized_query)
);

create index if not exists music_resolution_preferences_user_idx
  on public.music_resolution_preferences (user_id, intent_type);

create index if not exists music_resolution_preferences_query_idx
  on public.music_resolution_preferences (user_id, normalized_query);

alter table public.music_resolution_preferences enable row level security;

create policy "music_resolution_preferences_own"
  on public.music_resolution_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Active clarification candidates for short answers like "Kirko"
create table if not exists public.music_disambiguation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  intent_type text not null
    check (intent_type in ('track', 'playlist', 'album')),
  normalized_query text not null,
  candidates jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  selected_provider_id text
);

create index if not exists music_disambiguation_sessions_user_conv_idx
  on public.music_disambiguation_sessions (user_id, conversation_id, created_at desc);

create index if not exists music_disambiguation_sessions_expires_idx
  on public.music_disambiguation_sessions (expires_at);

alter table public.music_disambiguation_sessions enable row level security;

create policy "music_disambiguation_sessions_own"
  on public.music_disambiguation_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
