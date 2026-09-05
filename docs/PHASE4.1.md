# Phase 4.1 — Desktop State Stabilization + Bottom Overlay + Spotify

## Goals

1. Fix stuck ACTING / OPENING APP after successful desktop tools
2. Rebuild Ctrl+Space overlay as a first-class Aurum client (bottom-center, real Core)
3. Add connected-app architecture with Spotify as the first real integration

## Root cause (stale OPENING APP)

`tool_requested` and `tool_started` each created a **pending** activity. Only the second was patched on success, leaving an orphan pending row. Core caption used `activity.find(pending)`, so ACTING + OPENING APP / CHECKING DEVICES could resurface after Windows already succeeded. Presence `acting` was also toggled by coarse SSE status while Gemini continuation was still open.

## Lifecycle fix

- Single activity per `executionId` (upsert on request/start)
- `acting = inFlightTools.size > 0`
- Command-level RESPONDING is not a pending tool caption
- `get_connected_devices` caption is **Listing devices** (not CONNECTING)
- Connectivity captions reserved for PAIRING / CONNECTING / RECONNECTING / AUTHENTICATING
- Desktop `postResult` retries on failure

## Overlay

- Vite + React renderer with real `@aurum/ui` `AurumPresence`
- Bottom-center on **cursor’s display** workArea (taskbar-aware)
- Ctrl+Space: show / focus / hide (single window)
- Esc: cancel generation if streaming, else hide
- Agent via main-process device auth → `/api/devices/assistant/chat`
- **No** `/core?q=` redirect to main window

## Spotify

- OAuth Authorization Code + PKCE
- Scopes: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`
- Tokens encrypted at rest; service-role credential table denied to browsers
- Trusted `trackReference` / `deviceReference` UUIDs (30m TTL)
- Tools: search, play, pause, resume, next, previous, volume, playback state, devices
- Session media context for “pause it” / “turn it down”
- Bounded retry when no Spotify Connect device after open

## Migration

`supabase/migrations/20260322040000_phase41_integrations_spotify.sql`

## Env

```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/integrations/spotify/callback
INTEGRATION_TOKEN_KEY=   # optional
```

Spotify no longer accepts `localhost` aliases — use **exactly** `127.0.0.1` for local OAuth (authorization + token exchange must match the Dashboard URI).

## Manual setup

1. Apply Phase 4.1 migration in Supabase SQL editor
2. Create Spotify Developer app; add redirect URI exactly:
   `http://127.0.0.1:3000/api/integrations/spotify/callback`
3. Add client id/secret to `apps/web/.env.local`; restart web (open Aurum at `http://127.0.0.1:3000` for OAuth)
4. Settings → Integrations → Connect Spotify
5. Rebuild desktop: `npm run build:desktop` then `npm run dev:desktop`

## Out of scope

Voice, screen control, Gmail, Calendar, shell, delete tools.
