export type UiMessage = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  status: "complete" | "partial" | "error";
  metadata: Record<string, unknown>;
  created_at: string;
  /** Client-only streaming flag */
  streaming?: boolean;
};

export type UiConversation = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationGroup = {
  label: string;
  conversations: UiConversation[];
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function groupConversationsByDate(
  conversations: UiConversation[],
  now = new Date(),
): ConversationGroup[] {
  const today = startOfDay(now).getTime();
  const yesterday = today - 86_400_000;
  const weekAgo = today - 7 * 86_400_000;

  const buckets: Record<string, UiConversation[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    Older: [],
  };

  for (const c of conversations) {
    const t = startOfDay(new Date(c.updated_at)).getTime();
    if (t >= today) buckets.Today!.push(c);
    else if (t >= yesterday) buckets.Yesterday!.push(c);
    else if (t >= weekAgo) buckets["Previous 7 Days"]!.push(c);
    else buckets.Older!.push(c);
  }

  return (["Today", "Yesterday", "Previous 7 Days", "Older"] as const)
    .map((label) => ({ label, conversations: buckets[label]! }))
    .filter((g) => g.conversations.length > 0);
}

export { greetingForNow } from "@aurum/shared";
