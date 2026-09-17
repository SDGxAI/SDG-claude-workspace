import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
import { extractI18nKeyOrder } from "@/lib/html/i18n";
import { resolveImages } from "@/lib/storage";
import { Editor } from "@/components/editor/Editor";
import type { ContentState, DetectedElement } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const access = await getProjectAccess(id);
  if (!access) redirect("/login");
  if (!access.role) redirect("/projects");

  const supabase = await createClient();
  // Projekt und (erste) Seite sind unabhängig und laufen parallel.
  const [{ data: project }, { data: page }] = await Promise.all([
    supabase.from("projects").select("id, title, brand").eq("id", id).single(),
    supabase
      .from("pages")
      .select("id, template_html, content_state, detected_elements")
      .eq("project_id", id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (!project) notFound();
  if (!page) notFound();

  const contentState = page.content_state as ContentState;
  const detectedElements = page.detected_elements as DetectedElement[];

  // Bild-URLs signieren, damit Vorschau und Sidebar-Thumbnails greifen.
  const resolvedImages = await resolveImages(supabase, contentState.images);
  const initialHtml = renderHtml(
    page.template_html,
    { ...contentState, images: resolvedImages },
    detectedElements,
  );

  // Reihenfolge der Übersetzungs-Felder wie auf der Seite (oben nach unten).
  const i18nKeyOrder = contentState.i18n
    ? extractI18nKeyOrder(page.template_html)
    : undefined;

  return (
    <Editor
      projectId={id}
      pageId={page.id}
      projectTitle={project.title}
      brand={project.brand}
      initialHtml={initialHtml}
      detectedElements={detectedElements}
      initialContentState={contentState}
      resolvedImages={resolvedImages}
      i18nKeyOrder={i18nKeyOrder}
      canEdit={access.canEdit}
    />
  );
}
