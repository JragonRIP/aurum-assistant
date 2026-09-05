# Phase 3 — Tool Engine + Tasks + Notes

## Architecture

```
USER → Gemini (function call) → Aurum ToolRegistry
  → Zod validation → PermissionEngine → ToolExecutor
  → Supabase (RLS) → ToolResult → Gemini → final response
```

Gemini **proposes** actions. Aurum **authorizes and executes**. The model is never the security boundary.

Key modules:

| Area | Location |
|------|----------|
| Registry / executor / schemas | `packages/tools` |
| Supabase data access | `apps/web/src/lib/tools/data-access.ts` |
| Agent loop | `apps/web/src/lib/agent/agent-runner.ts` |
| SSE chat integration | `apps/web/src/lib/conversations/chat-service.ts` |
| Core UI wiring | `apps/web/src/components/core/*` |
| Migration | `supabase/migrations/20260322020000_phase3_tool_engine.sql` |

## Tools

| Tool | Permission | Notes |
|------|------------|-------|
| `get_current_time` | READ | Trusted server time + user timezone |
| `get_tasks` | READ | Filtered list; never arbitrary SQL |
| `search_notes` | READ | ILIKE text search |
| `create_task` | SAFE_WRITE | Date-only due when no clock time given |
| `update_task` | SAFE_WRITE | Allowed fields only; no ownership changes |
| `complete_task` | SAFE_WRITE | Ambiguous matches return `AMBIGUOUS_MATCH` |
| `create_note` | SAFE_WRITE | Persists user notes |

## Permissions

- **READ** / **SAFE_WRITE** — execute immediately after validation
- **CONFIRM** — create `approvals` row; do **not** execute; model cannot approve
- **RESTRICTED** — never execute

## Idempotency

Each tool call gets `execution_id` = `{generationId}:{geminiToolCallId}`.

`tool_runs` has a unique `(user_id, execution_id)` index. Replaying a **succeeded** execution returns the prior success and does **not** duplicate writes.

Intentional separate user requests use different execution IDs and may create identical titles.

## Loop limits

- `MAX_TOOL_ROUNDS = 6`
- `MAX_TOOL_CALLS_PER_REQUEST = 12`

## Adding a tool

1. Define Zod input schema (no `userId`)
2. Implement handler using `ToolExecutionContext.data`
3. `registry.register(...)` in `createDefaultRegistry`
4. Add tests for validation + happy path + failure codes

## SSE events

`tool_requested` · `tool_started` · `tool_succeeded` · `tool_failed` · `approval_required` · `surface_update` · `status` (`thinking`/`acting`/`responding`)

## Database

Apply Phase 3 migration in Supabase SQL editor (or CLI):

`supabase/migrations/20260322020000_phase3_tool_engine.sql`

Creates `tool_runs`, extends `approvals`, adds search indexes.

Tasks/notes tables already exist from Phase 1 (status enums: `TODO`, `IN_PROGRESS`, `WAITING`, `COMPLETED`, `CANCELLED`).

## Manual steps

1. Run the Phase 3 SQL migration on your Supabase project.
2. Restart `npm run dev`.
3. Sign in and exercise Tests A–I from the Phase 3 brief.

## Known limitations

- No Gmail / Calendar / Windows tools
- Notes search is lexical (ILIKE), not embeddings
- CONFIRM tools are architecturally ready; no dangerous production CONFIRM tool is exposed
- Ambiguous due times stay date-only (no invented 09:00)
- Full signed-in browser acceptance requires your session
