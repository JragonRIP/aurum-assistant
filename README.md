# Aurum

**AI Executive Assistant / Personal Operating System**

Private, cross-device assistant for Windows desktop, web, and iPhone PWA. One account, shared brain, carefully permissioned tools — never unrestricted computer control.

> **Status:** Phase 1 — Foundation complete. Real AI chat, voice, and desktop tools arrive in later phases.

---

## 1. Product overview

Aurum understands natural language, remembers useful information, manages work and personal responsibilities, and (eventually) interacts with approved services and a secured Windows companion.

V1 is built for one private user, with architecture ready for multi-tenant SaaS later.

## 2. Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Web / PWA  │  │  Electron   │  │  iPhone PWA │
│  (Next.js)  │  │  Desktop    │  │  (same web) │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
              ┌──────────────────┐
              │  Next.js API     │  ← OpenAI keys stay server-side
              │  Tool engine     │
              │  Approvals       │
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │  Supabase        │
              │  Auth + Postgres │
              │  RLS             │
              └──────────────────┘
```

## 3. Repository structure

```
aurum/
  apps/
    web/          Next.js App Router (primary UI + API)
    desktop/      Electron companion (secure preload + IPC)
  packages/
    shared/       Types, enums, navigation
    ui/           Design tokens + shared components
    database/     Zod schemas for DB entities
    ai/           System instructions / personality
    tools/        Tool registry, permissions, path security
  supabase/
    migrations/   SQL + RLS
  docs/           Architecture notes
  .env.example
  README.md
```

## 4. Prerequisites

- Node.js **20+** (tested on 24)
- npm 10+
- A [Supabase](https://supabase.com) project (for auth + database)
- Windows 10/11 for the desktop companion
- OpenAI API key — **Phase 2+** (not required for Phase 1)

## 5. Installation

```bash
# from repo root
npm install
```

## 6. Environment variables

Copy the example file:

```bash
copy .env.example apps\web\.env.local
```

| Variable | Client? | Required Phase | Purpose |
|----------|---------|----------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | 1 | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | 1 | Anon key (RLS-protected) |
| `NEXT_PUBLIC_APP_URL` | Yes | 1 | `http://localhost:3000` |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | 1+ | Server admin; never expose |
| `GEMINI_API_KEY` | **No** | 2+ | Server only |
| `GEMINI_TEXT_MODEL` | **No** | 2+ | Optional (default `gemini-3.6-flash`) |
| `AURUM_WEB_URL` | Desktop | 1 | Desktop loads this URL |

**Never** put `GEMINI_API_KEY` or the service role key in browser or Electron renderer code.

## 7. Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** and run:
   `supabase/migrations/20260322000000_phase1_foundation.sql`
3. In **Authentication → Providers**, enable Email.
4. (Optional) Disable “Confirm email” for solo local development.
5. Copy Project URL + anon key into `apps/web/.env.local`.

## 8. Gemini setup

Required for Phase 2 (text assistant):

1. Create an API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Set `GEMINI_API_KEY` in `apps/web/.env.local` only (never `NEXT_PUBLIC_`).
3. Optional: `GEMINI_TEXT_MODEL` to override the default (`gemini-3.6-flash`).
4. Aurum uses the official `@google/genai` SDK with `generateContentStream`.

Without `GEMINI_API_KEY`, the app still boots; Assistant shows **AI not configured**.

## 9. Web development

```bash
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000).

Without Supabase env vars you are sent to `/setup`. With them, create an account at `/signup`.

## 10. Desktop development

```bash
# terminal 1 — web must be running
npm run dev:web

# terminal 2
npm run dev:desktop
```

- Main window loads the web app.
- **Ctrl + Space** toggles the floating overlay (Phase 1: shell UI only).
- **Esc** dismisses the overlay.
- `contextIsolation: true`, `nodeIntegration: false`, validated IPC only.

## 11. Building the Windows app

```bash
npm run build --workspace=@aurum/desktop
npm run start --workspace=@aurum/desktop
```

Packaged installers (electron-builder) come in a later phase.

## 12. Voice architecture

Designed for OpenAI realtime with **short-lived server-authorized sessions**. Permanent keys stay on the server. Implementation: Phase 5.

## 13. Tool architecture

Central registry in `@aurum/tools`. Each tool has id, Zod schema, permission level, environment, and handler. The model never gets arbitrary shell access.

## 14. Permission system

| Level | Behavior |
|-------|----------|
| `READ` | Execute |
| `SAFE_WRITE` | Execute |
| `CONFIRM` | Create approval; wait for authenticated user |
| `RESTRICTED` | Blocked |

The AI cannot approve its own actions.

## 15. Security model

- Supabase Auth + Row Level Security on all user tables
- Server-only secrets
- Strict Electron preload bridge
- Path allowlists for desktop file tools (Phase 7)
- Audit logging schema ready (`activity_log`)

## 16. iPhone setup

PWA manifest is present. Phase 8 adds polished mobile voice + Action Button docs. Deep link target: `/assistant/voice` (stub in later phases).

## 17. Current implemented features

### Phase 1
- Monorepo with apps + packages
- Next.js UI shell + Supabase auth
- Electron shell with secure IPC + Ctrl+Space overlay
- Tool registry + permission engine + path security tests
- DB foundation migration with RLS

### Phase 2
- Real Gemini streaming chat (`@google/genai`)
- Conversation history sidebar (create / rename / delete)
- Message persistence + reload continuity
- Stop generation, retry, markdown rendering
- AI usage metadata table (`ai_generations`)
- Centralized model config (`GEMINI_TEXT_MODEL`, default `gemini-3.6-flash`)

## 18. Known limitations

- No tool calling yet (Phase 3)
- Overlay does not listen or speak yet (Phase 5)
- No Google / CRM / file tools
- PWA icons are placeholders
- Titles are derived deterministically (not a second model call)

## 19. Troubleshooting

| Issue | Fix |
|-------|-----|
| Redirected to `/setup` | Set Supabase env vars in `apps/web/.env.local` |
| Auth errors | Confirm migration ran; check Email provider |
| Desktop blank | Start web first; check `AURUM_WEB_URL` |
| Hotkey fails | Another app may own Ctrl+Space; check terminal log |

## 20. Future roadmap

Phases 2–12 as defined in the master build prompt: text assistant → tools → Windows companion → voice → memory → desktop files → PWA → Google → business → automations → commerce architecture (no fake bookings).

---

## Scripts

```bash
npm run dev:web        # Next.js
npm run dev:desktop    # Electron
npm run typecheck      # all workspaces
npm run lint           # all workspaces
npm run test           # tool security tests
npm run build:web
```
