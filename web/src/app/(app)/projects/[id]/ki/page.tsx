import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { getOrStartDraft } from "@/lib/actions/draft";
import { listAnthropicModels } from "@/lib/ai/models";
import { KiWorkspace, type KiComment } from "@/components/ki/KiWorkspace";

export const dynamic = "force-dynamic";

export default async function KiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const access = await getProjectAccess(id);
  if (!access) redirect("/login");
  if (!access.canEdit) redirect(`/projects/${id}`);

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("title")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const { data: page } = await supabase
    .from("pages")
    .select("id")
    .eq("project_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!page) notFound();

  const draftRes = await getOrStartDraft(page.id, id);
  if (!draftRes.ok) {
    redirect(`/projects/${id}`);
  }

  // Offene Kommentare zur Auswahl laden (mit Autor-E-Mail).
  const [{ data: comments }, { data: profiles }] = await Promise.all([
    supabase
      .from("comments")
      .select("id, author_id, body, status, parent_id, created_at")
      .eq("page_id", page.id)
      .is("parent_id", null)
      .eq("status", "offen")
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, email"),
  ]);
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const openComments: KiComment[] = (comments ?? []).map((c) => ({
    id: c.id,
    body: c.body,
    authorEmail: emailById.get(c.author_id ?? "") ?? "Unbekannt",
  }));

  const models = await listAnthropicModels();

  return (
    <KiWorkspace
      projectId={id}
      pageId={page.id}
      projectTitle={project.title}
      initialHtml={draftRes.draft.html}
      initialMessages={draftRes.draft.messages}
      openComments={openComments}
      models={models}
    />
  );
}
