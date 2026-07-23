"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ContentState } from "@/types/database";

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Speichert den aktuellen Bearbeitungsstand (content_state) einer Seite.
 * RLS erlaubt das Update nur für Editoren/Admins des Projekts.
 */
export async function savePageContent(
  pageId: string,
  projectId: string,
  contentState: ContentState,
): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  const { error } = await supabase
    .from("pages")
    .update({ content_state: contentState })
    .eq("id", pageId);

  if (error) {
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
