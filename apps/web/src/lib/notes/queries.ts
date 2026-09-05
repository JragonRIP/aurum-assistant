import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteRecord } from "@aurum/tools";

const NOTE_COLUMNS = "id, title, content, created_at, updated_at";

export function mapNoteRow(row: Record<string, unknown>): NoteRecord {
  return {
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    content: String(row.content),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function getNoteById(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
): Promise<NoteRecord | null> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("user_id", userId)
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapNoteRow(data as Record<string, unknown>) : null;
}

export async function listNotes(
  supabase: SupabaseClient,
  userId: string,
  opts?: { limit?: number },
): Promise<NoteRecord[]> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(opts?.limit ?? 40);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapNoteRow(row as Record<string, unknown>));
}
