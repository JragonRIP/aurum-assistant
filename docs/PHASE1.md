# Aurum documentation

## Phase status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation | **Implemented** |
| 2 | Text assistant | **Implemented** |
| 3 | Tool engine | Architecture started (`@aurum/tools`) |
| 4 | Windows desktop | Shell started (`apps/desktop`) |
| 5 | Voice | Not started |
| 6 | Memory | Schema ready |
| 7 | Windows tools | Path security ready |
| 8 | Mobile/PWA | Manifest placeholder |
| 9–12 | Google / Business / Automations / Commerce | Not started |

## Security principles

1. Permanent API keys never reach browsers or Electron renderers.
2. Tools go through the registry + permission gate.
3. Destructive / send / purchase actions require `CONFIRM` + user approval.
4. Desktop file access is limited to user-approved directories (Phase 7).
5. No arbitrary shell / PowerShell execution for the LLM.

## Phase 2 — Text assistant

### What works

- Authenticated conversation CRUD (create, list, rename, delete with confirmation)
- Real **Gemini** streaming via `/api/assistant/chat` (`@google/genai`)
- Server-side history load + context window (`@aurum/ai`)
- Markdown rendering with sanitization
- Stop generation / retry / title derivation
- Usage rows in `ai_generations` (model, tokens, latency)

### Manual actions

1. Apply `supabase/migrations/20260322010000_phase2_assistant.sql` in the SQL editor (optional but recommended).
2. Set `GEMINI_API_KEY` in `apps/web/.env.local` (server only).
3. Optional: `GEMINI_TEXT_MODEL` (default `gemini-3.6-flash`).
4. Restart `npm run dev:web`.
5. Sign in → Assistant → New conversation → chat.

### Architecture

- `packages/ai` — model config, system prompt, context builder, titles
- `apps/web/src/lib/conversations` — repository + streaming chat service
- `apps/web/src/app/api/assistant/chat` — authenticated SSE stream
- Central model: `getTextModel()` / `GEMINI_TEXT_MODEL`
