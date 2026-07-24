import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
import { extractI18nKeyOrder } from "@/lib/html/i18n";
import { resolveImages } from "@/lib/storage";
import { getSnapshots } from "@/lib/actions/pages";
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
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, brand")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const { data: page } = await supabase
    .from("pages")
    .select("id, template_html, content_state, detected_elements")
    .eq("project_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!page) notFound();

  const contentState = page.content_state as ContentState;
  const detectedElements = page.detected_elements as DetectedElement[];

  // Storage-Referenzen zu signierten URLs auflösen, damit Vorschau und
  // Sidebar-Thumbnails die Bilder anzeigen können.
  const resolvedImages = await resolveImages(supabase, contentState.images);
  const initialHtml = renderHtml(
    page.template_html,
    { ...contentState, images: resolvedImages },
    detectedElements,
  );

  const initialSnapshots = access.canEdit ? await getSnapshots(page.id) : [];

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
      initialSnapshots={initialSnapshots}
      i18nKeyOrder={i18nKeyOrder}
      canEdit={access.canEdit}
    />
  );
}
