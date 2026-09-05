# Phase 4 — Windows Device Bridge + Safe Desktop Control

## Goal

Turn the Electron companion into an authenticated Aurum device that can run a **small, typed, permissioned** set of Windows actions. The model never controls Windows directly.

## Architecture

```
User → Gemini → ToolRegistry → validation → permission
  → device dispatch (device_requests) → Windows companion
  → desktop validation → Windows adapter → result → backend → UI/Gemini
```

Two validation boundaries: **backend** and **desktop**.

## Pairing

1. Web: Settings → Devices → “Connect Windows device” creates a short-lived pairing code (`device_pairing_tokens`, **hash only**).
2. Desktop overlay: enter code → `POST /api/devices/pair`.
3. Backend issues `deviceId` + one-time `deviceSecret` (hash stored as `credential_hash`).
4. Desktop stores credential via Electron `safeStorage` (main process only).

Pairing codes: expire (~10m), one-time, user-scoped.

## Device credentials

- Renderer never sees the secret.
- Authorization header: `Bearer <deviceId>.<deviceSecret>`
- Revoke clears `credential_hash` and sets `status=disabled`.

## Connection protocol

Outbound from desktop (no inbound ports):

- `POST /api/devices/bridge/heartbeat` — presence + approved roots
- `GET /api/devices/bridge/poll?wait=` — long-poll pending requests
- `POST /api/devices/bridge/result` — correlate by `executionId`

Stale heartbeat (>45s) → Offline in system health.

## Request envelope

`requestId`, `deviceId`, `tool`, `executionId`, `payload`, `issuedAt`, `expiresAt` (~45s TTL).

Replay: unique `(device_id, execution_id)`; desktop remembers recent execution IDs; result posts are idempotent.

**No delayed queues** — offline returns `DEVICE_OFFLINE`.

## Tools (Phase 4)

| Tool | Env | Permission |
|------|-----|------------|
| get_connected_devices | CLOUD | READ |
| get_running_apps | DESKTOP | READ |
| open_application | DESKTOP | SAFE_WRITE |
| open_url | DESKTOP | SAFE_WRITE |
| list_directory | DESKTOP | READ |
| search_files | DESKTOP | READ |
| read_file | DESKTOP | READ |
| open_file | DESKTOP | SAFE_WRITE |
| open_folder | DESKTOP | SAFE_WRITE |
| create_folder | DESKTOP | SAFE_WRITE |
| copy_file | DESKTOP | SAFE_WRITE |
| move_file | DESKTOP | SAFE_WRITE |
| rename_file | DESKTOP | SAFE_WRITE |

**Forbidden forever here:** `run_command`, shell/PowerShell execution, arbitrary exe paths, delete tools, screen/mouse automation.

## Application resolver

Resolves Start Menu `.lnk` shortcuts by friendly name. Blocks shells/system utilities. Ambiguous matches → `AMBIGUOUS_MATCH`.

## Approved folders

Per `(user, device)`. Default: **none**. Native folder picker on desktop. Paths validated for traversal, UNC, sensitive locations, executables.

## Overlay + hotkey

- Ctrl+Space toggles frameless overlay (large Core + command field)
- Esc dismisses
- Tray: Open Aurum / Show Overlay / Status / Launch at Windows start (default **off**) / Quit
- Overlay commands open web Core (`/core?q=...`) which auto-sends via the same agent path

## Migration

`supabase/migrations/20260322030000_phase4_device_bridge.sql`

Requires `SUPABASE_SERVICE_ROLE_KEY` for bridge/pairing exchange.

## Adding a safe device tool

1. Add schema + `deviceTool(...)` in `packages/tools/src/desktop-tools.ts`
2. Implement handler in `apps/desktop/src/main/windows-tools.ts` with path/app checks
3. Register in `registerDesktopTools`
4. Add security tests
5. Never accept free-form shell/command strings

## Known limitations

- Long-poll (not WebSocket); fine for Phase 4
- Overlay command UX routes through main Core window (not fully in-overlay streaming yet)
- App resolution depends on Start Menu shortcuts
- Auto-start with Windows is opt-in via tray (default off)
- No auto-updater
- Manual folder approval via desktop picker (web UI lists/removes only)
- Junction/symlink escape: desktop `assertApprovedPath` uses `fs.realpathSync` after allowlist check

## Latency (device tool path)

Instrument via structured logs: `device_request_dispatch` → desktop receive → execute → `device_request_complete` (`durationMs`). Typical local long-poll + open_application target &lt; 1–3s excluding Gemini TTFT.

## Security review answers

| Question | Answer |
|----------|--------|
| Can Gemini run arbitrary PowerShell? | **NO** |
| Can Gemini run arbitrary shell? | **NO** |
| Can Gemini provide arbitrary exe path? | **NO** |
| Can renderer access Node fs? | **NO** |
| Can renderer access device credential? | **NO** |
| Can user A control user B device? | **NO** (RLS + credential scope) |
| Can file request escape approved roots? | **NO** |
| Can symlink/junction escape? | **Defended** via canonicalize + allowlist (Windows junction edge cases should be re-tested on real FS) |
| Can Aurum open executable/script files? | **NO** |
| Can stale request execute after reconnect? | **NO** (TTL + expire) |
| Can retry duplicate an operation? | **NO** (executionId idempotency) |
| Can revoked device reconnect? | **NO** |
