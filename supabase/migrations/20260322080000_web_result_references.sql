-- Expand integration_references kinds for web research / downloads.
-- Spotify kinds unchanged.

alter table public.integration_references
  drop constraint if exists integration_references_kind_check;

alter table public.integration_references
  add constraint integration_references_kind_check
  check (
    kind in (
      'track',
      'device',
      'album',
      'playlist',
      'web_page',
      'web_image',
      'web_file'
    )
  );
