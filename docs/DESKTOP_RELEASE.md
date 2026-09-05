# Desktop releases (one-command)

Preferred local command (Cursor / you):

```powershell
npm run desktop:release:patch
# or: desktop:release:minor / desktop:release:major
```

That script:

1. Safety checks (clean tree, `main`, origin, workflow, tag availability)
2. Bumps `apps/desktop/package.json`
3. Runs helper tests + desktop typecheck/tests + tag/version assert
4. Commits `chore(desktop): release X.Y.Z`
5. Creates annotated tag `vX.Y.Z`
6. Pushes commit then tag to `origin`

GitHub Actions (`.github/workflows/desktop-release.yml`) builds/publishes the installer.

Status (no mutation):

```powershell
npm run desktop:release:status
```

No `GH_TOKEN` / PAT required locally. Do not force-push. Details: `docs/PHASE4.3.md`.
