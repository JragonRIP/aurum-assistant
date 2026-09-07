-- Phase 5 Voice settings (user-scoped). Raw audio is never stored.

create table if not exists public.voice_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  spoken_mode text not null default 'always_voice'
    check (spoken_mode in ('always_voice', 'short_only', 'never')),
  tts_voice text not null default 'Kore',
  input_device_id text,
  output_device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.voice_settings enable row level security;

drop policy if exists "voice_settings_all_own" on public.voice_settings;
create policy "voice_settings_all_own"
  on public.voice_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
