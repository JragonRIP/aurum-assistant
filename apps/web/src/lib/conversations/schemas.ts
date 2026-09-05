import { z } from "zod";
import {
  MAX_CONVERSATION_TITLE_CHARS,
  MAX_USER_MESSAGE_CHARS,
} from "@aurum/ai";

export const CreateConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(MAX_CONVERSATION_TITLE_CHARS)
    .optional(),
});

export const RenameConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(MAX_CONVERSATION_TITLE_CHARS, "Title is too long"),
});

export const ChatRequestSchema = z
  .object({
    conversationId: z.string().uuid(),
    content: z
      .string()
      .trim()
      .min(1, "Message cannot be empty")
      .max(MAX_USER_MESSAGE_CHARS, "Message is too long")
      .optional(),
    /** Retry assistant generation after a failed/partial turn without duplicating the user message */
    retryOfUserMessageId: z.string().uuid().optional(),
    /** Client-stable id for this generation (dedupe / reconcile) */
    generationId: z.string().uuid().optional(),
    /** Client Date.now() when Send was pressed (latency trace) */
    clientSentAt: z.number().int().positive().optional(),
  })
  .refine((v) => Boolean(v.content) || Boolean(v.retryOfUserMessageId), {
    message: "Provide content or retryOfUserMessageId",
  });

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
