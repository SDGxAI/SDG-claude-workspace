import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { listVersions, type VersionMeta } from "@/lib/actions/versions";
import { renderHtml } from "@/lib/html/render";
import { resolveImages } from "@/lib/storage";
import { ExportMenu } from "@/components/projects/ExportMenu";
import { DeleteProjectButton } from "@/components/projects/DeleteProjectButton";
import { IngestPanel } from "@/components/projects/IngestPanel";
import { AnnounceButton } from "@/components/projects/AnnounceButton";
import { ShopifyBar } from "@/components/projects/ShopifyBar";
import { createAdminClient } from "@/lib/supabase/admin";
import { shopifyPreviewUrl } from "@/lib/shopify/paths";
import { liveViewUrl, proxyBaseUrl } from "@/lib/shopify/proxy";
import {
  CommentablePreview,
  type CommentThread,
} from "@/components/comments/CommentablePreview";
import { PageStudio } from "@/components/studio/PageStudio";
import { brandGradient } from "@/lib/ui/brandColor";
import { defaultModel, listModels } from "@/lib/ai/claude";
import { loadPage } from "@/lib/page/store";
import type { ContentState, DetectedElement } from "@/types/database";

export const dynamic = "force-dynamic";
// Mehr Zeit für die KI beim „Umsetzen" (langsamere Modelle).
export const maxDuration = 60;

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const access = await getProjectAccess(id);
  if (!access) redirect("/login");

  const supabase = await createClient();
  // Projekt und Seite (nur Kennung – der Inhalt kommt weiter unten) parallel.
  const [{ data: project }, { data: page }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("pages").select("id, updated_at").eq("project_id", id).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!project) notFound();

  const isShopify = project.source === "shopify";
  const useAi = !isShopify && access.canEdit;
  let shopInfo: { name: string; domain: string } | null = null;
  let previewHtml =
    "<p style=\"font-family:sans-serif;padding:2rem\">Keine Seite vorhanden.</p>";
  let threads: CommentThread[] = [];
  let currentUserEmail = "";
  let versions: VersionMeta[] = [];
  let models: { id: string; label: string }[] = [];
  let aiModel = "";

  // Seiteninhalt für die Anzeige (Shopify: Vorschau-Stand, sonst eine HTML-Datei).
  const loadHtml = async (): Promise<string | null> => {
    if (!isShopify) return (await loadPage(id))?.html ?? null;
    const { data: row } = await supabase
      .from("pages")
      .select("template_html, content_state, detected_elements")
      .eq("id", page!.id)
      .single();
    if (!row) return null;
    const contentState = row.content_state as ContentState;
    const images = await resolveImages(supabase, contentState.images);
    return renderHtml(row.template_html, { ...contentState, images }, row.detected_elements as DetectedElement[]);
  };

  if (page) {
    // Alles Übrige gleichzeitig laden – jede Wartezeit nur einmal.
    const [conn, html, { data: comments }, { data: profiles }, currentProfile, versionList, ai] = await Promise.all([
      isShopify && project.shopify_connection_id
        ? createAdminClient()
            .from("shopify_connections")
            .select("name, shop_domain")
            .eq("id", project.shopify_connection_id)
            .maybeSingle()
            .then((r) => r.data)
        : Promise.resolve(null),
      loadHtml(),
      supabase.from("comments").select("*").eq("page_id", page.id).order("created_at", { ascending: true }),
      supabase.from("profiles").select("id, email"),
      getCurrentProfile(),
      listVersions(page.id),
      useAi ? Promise.all([listModels(), defaultModel()]) : Promise.resolve(null),
    ]);
    if (conn) shopInfo = { name: conn.name, domain: conn.shop_domain };
    if (html) previewHtml = html;
    if (ai) [models, aiModel] = ai;
    versions = versionList;

    currentUserEmail = currentProfile?.email ?? "";
    const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));

    const topLevel = (comments ?? []).filter((c) => !c.parent_id);
    const repliesByParent = new Map<string, typeof comments>();
    for (const c of comments ?? []) {
      if (c.parent_id) {
        const list = repliesByParent.get(c.parent_id) ?? [];
        list.push(c);
        repliesByParent.set(c.parent_id, list);
      }
    }

    threads = topLevel.map((c) => ({
      id: c.id,
      body: c.body,
      xPct: Number(c.x_pct),
      yPct: Number(c.y_pct),
      anchor: c.anchor ?? null,
      status: c.status,
      createdAt: c.created_at,
      authorEmail: emailById.get(c.author_id ?? "") ?? "Unbekannt",
      pagePath: c.page_path ?? null,
      replies: (repliesByParent.get(c.id) ?? []).map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        authorEmail: emailById.get(r.author_id ?? "") ?? "Unbekannt",
      })),
    }));
  }

  return (
    <div className="w-full pb-8">
      {/* Kopfzeile: gleiche Breite/Ausrichtung wie die obere Navi-Leiste. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-4 px-4 pt-6">
        <div>
          <Link href="/projects" className="text-sm text-neutral-500 hover:text-sdg-red">
            ← Projekte
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{project.title}</h1>
            <span className={`rounded-full bg-gradient-to-br px-3 py-1 text-xs font-semibold text-neutral-700 ${brandGradient(project.brand)}`}>
              {project.brand}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {access.isAdmin && <AnnounceButton projectId={id} />}
          {page && !isShopify && <ExportMenu projectId={id} isAdmin={access.isAdmin} />}
          {access.isAdmin && (
            <DeleteProjectButton projectId={id} title={project.title} />
          )}
          {access.canEdit && page && isShopify && (
            <Link
              href={`/projects/${id}/ki`}
              className="rounded-lg border border-sdg-red px-4 py-2 text-sm font-medium text-sdg-red transition-colors hover:bg-sdg-red-light"
            >
              ✏️ Mit KI bearbeiten
            </Link>
          )}
        </div>
      </div>

      {isShopify && (
        <div className="mx-auto max-w-6xl px-4">
          <ShopifyBar
            projectId={id}
            shopName={shopInfo?.name ?? "Shop nicht mehr verbunden"}
            themeName={project.shopify_theme_name ?? "?"}
            path={project.shopify_path ?? "/"}
            previewUrl={
              shopInfo && project.shopify_theme_id
                ? shopifyPreviewUrl(shopInfo.domain, project.shopify_theme_id, project.shopify_path ?? "/")
                : null
            }
            canEdit={access.canEdit}
          />
        </div>
      )}

      {/* Vorschau bleibt voll breit (große Fläche). */}
      <div className="mt-4">
        {page && !isShopify ? (
          <PageStudio
            projectId={id}
            pageId={page.id}
            html={previewHtml}
            threads={threads}
            versions={versions}
            canComment={access.canComment}
            canEdit={access.canEdit}
            currentUserEmail={currentUserEmail}
            models={models}
            defaultModel={aiModel}
          />
        ) : page ? (
          <CommentablePreview
            previewHtml={previewHtml}
            pageId={page.id}
            projectId={id}
            threads={threads}
            canComment={access.canComment}
            canModerate={access.canEdit}
            currentUserEmail={currentUserEmail}
            versions={versions}
            allowScripts={isShopify}
            proxyBase={isShopify ? proxyBaseUrl(id) : null}
            mainPath={project.shopify_path ?? "/"}
            liveSrc={
              isShopify
                ? `${liveViewUrl(id)}?v=${encodeURIComponent(page.updated_at ?? "")}`
                : null
            }
          />
        ) : (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
            Keine Seite vorhanden.
          </p>
        )}
      </div>

      {access.canEdit && page && !isShopify && (
        <div className="mx-auto max-w-6xl px-4">
          <IngestPanel projectId={id} initialToken={project.ingest_token ?? null} />
        </div>
      )}
    </div>
  );
}
