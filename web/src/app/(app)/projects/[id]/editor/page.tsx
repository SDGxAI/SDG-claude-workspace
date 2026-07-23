import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
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
  const initialHtml = renderHtml(page.template_html, contentState, detectedElements);

  return (
    <Editor
      projectId={id}
      pageId={page.id}
      projectTitle={project.title}
      brand={project.brand}
      initialHtml={initialHtml}
      detectedElements={detectedElements}
      initialContentState={contentState}
      canEdit={access.canEdit}
    />
  );
}
