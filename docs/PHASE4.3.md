# Phase 4.3 — Desktop Auto-Updater

## Architecture

`DesktopUpdater` (Electron main) wraps `electron-updater` with GitHub Releases:

- owner: `JragonRIP`
- repo: `aurum-assistant`
- provider configured in `apps/desktop/electron-builder.yml`

Renderer/preload only call:

- `aurum:updater-get-state`
- `aurum:updater-check`
- `aurum:updater-install`

No arbitrary update URLs from the model or renderer.

## Behavior

| Mode | Updater |
|------|---------|
| Development (`!app.isPackaged`) | Disabled |
| Packaged | Check ~8s after start, then every 5 hours |

Download is background. When ready: dialog **Restart & Update** / **Later**, plus tray **Restart to Update Aurum**.

## Release

Set a GitHub token with `repo` scope **only for publishing** (never in the app):

```powershell
$env:GH_TOKEN = "ghp_..."   # or fine-grained token with Contents: Read/Write for releases
npm run release:desktop
```

Local package without publish:

```powershell
npm run pack:desktop
```

Artifacts (in `apps/desktop/release/`):

- `Aurum-Setup-x.y.z.exe`
- `latest.yml`
- `Aurum-Setup-x.y.z.exe.blockmap`

## Unsigned builds

Aurum is currently unsigned. `verifyUpdateCodeSignature` is `false` so electron-updater can accept unsigned NSIS builds. Windows SmartScreen is **not** bypassed. When Authenticode signing is added, set verification back to `true`.

## Manual test (do not claim pass until run)

1. Install packaged `0.2.1`
2. Publish `0.2.2` via `npm run release:desktop`
3. Launch `0.2.1` → wait for check / use tray **Check for Updates**
4. Confirm download + Restart & Update
5. Confirm relaunch as `0.2.2`, pairing, Ctrl+Space, production backend
