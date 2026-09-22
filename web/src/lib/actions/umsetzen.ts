"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
import { editHtmlWithAI } from "@/lib/ai/editHtml";
import { ingestHtmlIntoProject } from "@/lib/ingest/apply";
import type { ContentState, DetectedElement } from "@/types/database";

export type UmsetzenResult = { ok: true } | { ok: false; error: string };

/**
 * Setzt einen Kommentar per KI um, indem die KI die GESAMTE Seite anpasst
 * (Text, Bilder, Elemente entfernen/hinzufügen, Layout …). Der vorherige
 * Stand wird als Version gesichert, das Ergebnis wird zur neuen aktuellen
 * Version.
 */
export async function umsetzenComment(
  commentId: string,
  pageId: string,
  projectId: string,
): Promise<UmsetzenResult> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) {
    return { ok: false, error: "Keine Berechtigung zum Bearbeiten dieser Seite." };
  }

  const supabase = await createClient();

  const { data: comment } = await supabase
    .from("comments")
    .select("body")
    .eq("id", commentId)
    .single();
  if (!comment) return { ok: false, error: "Kommentar nicht gefunden." };

  const { data: page } = await supabase
    .from("pages")
    .select("template_html, content_state, detected_elements")
    .eq("id", pageId)
    .single();
  if (!page) return { ok: false, error: "Seite nicht gefunden." };

  // Aktuelles, vollständiges HTML aufbauen (mit den GESPEICHERTEN Bildwerten,
  // nicht mit temporär signierten URLs – so bleiben Bilder dauerhaft gültig).
  const currentHtml = renderHtml(
    page.template_html,
    page.content_state as ContentState,
    page.detected_elements as DetectedElement[],
  );

  const edited = await editHtmlWithAI(currentHtml, comment.body);
  if (!edited.ok) return { ok: false, error: edited.error };

  // Sichern + als neue aktuelle Version speichern (gleiche Pipeline wie die
  // Claude-Schnittstelle: alte Version archivieren, neu parsen).
  const result = await ingestHtmlIntoProject(supabase, {
    pageId,
    projectId,
    html: edited.html,
    source: "umsetzen",
    label: `KI-Umsetzung: ${comment.body.slice(0, 80)}`,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/editor`);
  return { ok: true };
}
