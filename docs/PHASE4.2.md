# Phase 4.2 — Deep Windows Control + Full Spotify Management

## Windows tools
Typed `WindowsSystemAdapter` on the desktop companion + `registerWindowsSystemTools`.
Trusted `windowReference` / `audioDeviceReference` UUIDs (desktop-local TTL map).
No shell/PowerShell strings from the model.

## Spotify
Expanded scopes (playlist + library). Reconnect/upgrade in Settings → Integrations.
Trusted references for track/album/playlist/device mutations.

## Confirmations
CONFIRM tools pause for authenticated Approve/Reject (`/api/approvals/[id]/decide`).

## Packaging
Desktop version **0.2.0** → `Aurum-Setup-0.2.0.exe`.
