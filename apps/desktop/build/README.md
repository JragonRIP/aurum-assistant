# Aurum Console — Windows packaging assets

electron-builder `buildResources` for the Windows companion.

| File | Role |
|------|------|
| `icon.png` | Master lossless source (1024×1024) |
| `icon.ico` | Multi-res Windows icon (16–256) for EXE, NSIS, shortcuts |
| `icon-{16,24,32,48,64,128,256,512,1024}.png` | Preview / tooling sizes |
| `tray-16.png` / `tray-32.png` | Tray-compatible copies |
| `installer.nsh` | NSIS: remove legacy `Aurum.lnk` shortcuts on upgrade |

Regenerate ICO from the master PNG:

```bash
# after installing sharp + png-to-ico somewhere Node can resolve
node apps/desktop/scripts/build-icon.mjs
```

Runtime copies live under `dist/assets/` (copied by `scripts/copy-brand-assets.mjs` during `npm run build`).
