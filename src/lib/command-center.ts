// Stage 2 Phase 01 — Command Center data access. Reads command_center_notes
// directly (RLS-scoped, staff-only); writes go through the admin-only RPCs,
// matching the established direct-supabase.rpc(...) convention for this
// class of administrative operation (Gate B-G, Stage M/N, Stage O).

import { supabase } from "./supabase";
import type { CommandCenterNoteCategory, CommandCenterNoteRow } from "@/types/operations";

export async function fetchCommandCenterNotes(): Promise<CommandCenterNoteRow[]> {
  const { data, error } = await supabase
    .from("command_center_notes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CommandCenterNoteRow[];
}

export async function addCommandCenterNote(category: CommandCenterNoteCategory, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("add_command_center_note", { p_category: category, p_body: body });
  if (error) throw error;
  return data as string;
}

export async function resolveCommandCenterNote(noteId: string): Promise<void> {
  const { error } = await supabase.rpc("resolve_command_center_note", { p_note_id: noteId });
  if (error) throw error;
}
