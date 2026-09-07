/**
 * Host-side memory tool actions for the agent loop.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolResult } from "@aurum/tools";
import type { MemoryType } from "@aurum/shared";
import {
  createMemory,
  forgetMemory,
  getMemoryById,
  getMemoryByKey,
  searchMemories,
  updateMemory,
} from "./service";
import { containsSecretMaterial } from "./types";

export async function runMemoryAction(opts: {
  supabase: SupabaseClient;
  userId: string;
  action: string;
  input: Record<string, unknown>;
  conversationId?: string;
}): Promise<ToolResult> {
  const { supabase, userId, action, input } = opts;
  const sourceId = opts.conversationId ?? null;

  try {
    switch (action) {
      case "search": {
        const rows = await searchMemories(supabase, userId, {
          query: typeof input.query === "string" ? input.query : undefined,
          type: input.type as MemoryType | undefined,
          limit: typeof input.limit === "number" ? input.limit : 10,
        });
        return {
          success: true,
          data: {
            results: rows.map((m) => ({
              id: m.id,
              title: m.title,
              content: m.content,
              type: m.memory_type,
              importance: m.importance_level,
              canonicalKey: m.canonical_key,
              updatedAt: m.updated_at,
            })),
          },
          message:
            rows.length === 0
              ? "No matching memories."
              : `Found ${rows.length} memory(ies).`,
          activityLabel: "Searched memory",
        };
      }
      case "get": {
        const byId =
          typeof input.id === "string"
            ? await getMemoryById(supabase, userId, input.id)
            : null;
        const byKey =
          !byId && typeof input.canonicalKey === "string"
            ? await getMemoryByKey(supabase, userId, input.canonicalKey)
            : null;
        const mem = byId ?? byKey;
        if (!mem || mem.status === "DELETED") {
          return {
            success: false,
            error: { code: "NOT_FOUND", message: "Memory not found." },
            activityLabel: "Memory missing",
          };
        }
        return {
          success: true,
          data: mem,
          message: mem.title,
          activityLabel: "Loaded memory",
        };
      }
      case "remember": {
        const title = String(input.title ?? "").trim();
        const content = String(input.content ?? "").trim();
        if (!title || !content) {
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Title and content required." },
            activityLabel: "Remember failed",
          };
        }
        if (containsSecretMaterial(title) || containsSecretMaterial(content)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "I can't store secrets, passwords, or API keys.",
            },
            activityLabel: "Remember blocked",
          };
        }
        const mem = await createMemory(supabase, userId, {
          title,
          content,
          type: (input.type as MemoryType) ?? "FACT",
          importance: (input.importance as "USEFUL") ?? "USEFUL",
          canonicalKey:
            typeof input.canonicalKey === "string" ? input.canonicalKey : null,
          sourceType: "USER_EXPLICIT",
          sourceId,
          confidence: 0.99,
        });
        return {
          success: true,
          data: { id: mem.id, canonicalKey: mem.canonical_key },
          message: "Got it.",
          activityLabel: "Remembered",
        };
      }
      case "update": {
        let id =
          typeof input.id === "string" ? input.id : undefined;
        if (!id && typeof input.canonicalKey === "string") {
          const existing = await getMemoryByKey(
            supabase,
            userId,
            input.canonicalKey,
          );
          id = existing?.id;
        }
        if (!id) {
          return {
            success: false,
            error: { code: "NOT_FOUND", message: "Memory not found." },
            activityLabel: "Update failed",
          };
        }
        if (
          (typeof input.content === "string" &&
            containsSecretMaterial(input.content)) ||
          (typeof input.title === "string" && containsSecretMaterial(input.title))
        ) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "I can't store secrets, passwords, or API keys.",
            },
            activityLabel: "Update blocked",
          };
        }
        const mem = await updateMemory(supabase, userId, id, {
          title: typeof input.title === "string" ? input.title : undefined,
          content: typeof input.content === "string" ? input.content : undefined,
          type: input.type as MemoryType | undefined,
          importance: input.importance as "USEFUL" | undefined,
          sourceType: "USER_CORRECTION",
          sourceId,
        });
        return {
          success: true,
          data: { id: mem.id },
          message: "Updated.",
          activityLabel: "Memory updated",
        };
      }
      case "forget": {
        const target =
          (typeof input.id === "string" && input.id) ||
          (typeof input.canonicalKey === "string" && input.canonicalKey) ||
          null;
        if (!target) {
          if (typeof input.query === "string") {
            const hits = await searchMemories(supabase, userId, {
              query: input.query,
              limit: 3,
            });
            if (hits.length === 1) {
              const res = await forgetMemory(supabase, userId, hits[0]!.id);
              return {
                success: res.forgotten,
                data: res,
                message: res.forgotten ? "Forgotten." : "Nothing to forget.",
                activityLabel: "Forgot",
              };
            }
            return {
              success: false,
              error: {
                code: "AMBIGUOUS_MATCH",
                message:
                  hits.length === 0
                    ? "I couldn't find that memory."
                    : "Which memory should I forget?",
              },
              data: { candidates: hits.map((h) => ({ id: h.id, title: h.title })) },
              activityLabel: "Forget unclear",
            };
          }
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Specify a memory to forget." },
            activityLabel: "Forget failed",
          };
        }
        const res = await forgetMemory(supabase, userId, target);
        return {
          success: res.forgotten,
          data: res,
          message: res.forgotten ? "Forgotten." : "Nothing to forget.",
          activityLabel: "Forgot",
        };
      }
      default:
        return {
          success: false,
          error: { code: "UNKNOWN_TOOL", message: `Unknown memory action: ${action}` },
          activityLabel: "Memory action",
        };
    }
  } catch (err) {
    return {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: err instanceof Error ? err.message : "Memory action failed.",
      },
      activityLabel: "Memory failed",
    };
  }
}
