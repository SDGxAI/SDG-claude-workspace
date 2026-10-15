import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { getOrStartDraft } from "@/lib/actions/draft";
import { listAnthropicModels } from "@/lib/ai/models";
import { KiWorkspace, type KiComment } from "@/components/ki/KiWorkspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyPreviewUrl } from "@/lib/shopify/paths";
import { liveViewUrl, proxyBaseUrl } from "@/lib/shopify/proxy";

export const dynamic = "force-dynamic";
// Mehr Zeit für langsamere Modelle (z. B. Sonnet/Opus mit Denkstufe).
export const maxDuration = 60;

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
    .select("*")
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
      .select("*")
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
    pagePath: c.page_path ?? null,
  }));

  const models = await listAnthropicModels();

  // Shopify-Projekt: Link zur echten Vorschau im Shop.
  let previewUrl: string | null = null;
  if (project.source === "shopify" && project.shopify_connection_id && project.shopify_theme_id) {
    const { data: conn } = await createAdminClient()
      .from("shopify_connections")
      .select("shop_domain")
      .eq("id", project.shopify_connection_id)
      .maybeSingle();
    if (conn) {
      previewUrl = shopifyPreviewUrl(conn.shop_domain, project.shopify_theme_id, project.shopify_path ?? "/");
    }
  }

  return (
    <KiWorkspace
      projectId={id}
      pageId={page.id}
      projectTitle={project.title}
      initialHtml={draftRes.draft.html}
      initialMessages={draftRes.draft.messages}
      openComments={openComments}
      models={models}
      shopifyPreviewUrl={previewUrl}
      proxyBase={previewUrl ? proxyBaseUrl(id) : null}
      liveSrc={previewUrl ? liveViewUrl(id) : null}
    />
  );
}
