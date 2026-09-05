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

## Automated release (GitHub Actions)

Pushing a version tag triggers `.github/workflows/desktop-release.yml` on `windows-latest`:

1. `npm ci`
2. Assert `vX.Y.Z` matches `apps/desktop/package.json`
3. Desktop typecheck + tests + build
4. Stage + electron-builder `--publish always` (uses Actions `GITHUB_TOKEN`)
5. Verify `Aurum-Setup-X.Y.Z.exe`, `.blockmap`, and `latest.yml`

Normal branch pushes do **not** publish a desktop installer (Vercel still deploys web independently).

### Developer flow (one command)

```powershell
npm run desktop:release:status   # optional
npm run desktop:release:patch    # or :minor / :major
```

This bumps `apps/desktop/package.json`, validates, commits, tags `vX.Y.Z`, and pushes
commit + tag. GitHub Actions publishes the installer. No local `GH_TOKEN`.

Working tree must be clean and branch must be `main` (override with
`AURUM_RELEASE_BRANCH` only if intentional).

Bump-only (no commit/tag/push): `npm run release:patch`.
Local package without publish: `npm run pack:desktop`.


Artifacts (in `apps/desktop/release/`):

- `Aurum-Setup-x.y.z.exe`
- `latest.yml`
- `Aurum-Setup-x.y.z.exe.blockmap`

## Unsigned builds

Aurum is currently unsigned. `verifyUpdateCodeSignature` is `false` so electron-updater can accept unsigned NSIS builds. Windows SmartScreen is **not** bypassed. When Authenticode signing is added, set verification back to `true`.
