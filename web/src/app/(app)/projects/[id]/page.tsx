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
import {
  CommentablePreview,
  type CommentThread,
} from "@/components/comments/CommentablePreview";
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
  // Projekt und (erste) Seite sind unabhängig und laufen parallel.
  const [{ data: project }, { data: page }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase
      .from("pages")
      .select("id, template_html, content_state, detected_elements")
      .eq("project_id", id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (!project) notFound();

  let previewHtml =
    "<p style=\"font-family:sans-serif;padding:2rem\">Keine Seite vorhanden.</p>";
  let threads: CommentThread[] = [];
  let currentUserEmail = "";
  let versions: VersionMeta[] = [];

  if (page) {
    const contentState = page.content_state as ContentState;
    const resolvedImages = await resolveImages(supabase, contentState.images);
    previewHtml = renderHtml(
      page.template_html,
      { ...contentState, images: resolvedImages },
      page.detected_elements as DetectedElement[],
    );

    const [{ data: comments }, { data: profiles }, currentProfile, versionList] =
      await Promise.all([
        supabase
          .from("comments")
          .select("id, parent_id, author_id, body, x_pct, y_pct, status, created_at")
          .eq("page_id", page.id)
          .order("created_at", { ascending: true }),
        supabase.from("profiles").select("id, email"),
        getCurrentProfile(),
        listVersions(page.id),
      ]);
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
      status: c.status,
      createdAt: c.created_at,
      authorEmail: emailById.get(c.author_id ?? "") ?? "Unbekannt",
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
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
            {project.title}
          </h1>
          <div className="mt-1 text-sm text-neutral-500">
            {project.brand}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {access.canEdit && page && <ExportMenu projectId={id} />}
          {access.isAdmin && (
            <DeleteProjectButton projectId={id} title={project.title} />
          )}
          {access.canEdit && page && (
            <Link
              href={`/projects/${id}/ki`}
              className="rounded-lg border border-sdg-red px-4 py-2 text-sm font-medium text-sdg-red transition-colors hover:bg-sdg-red-light"
            >
              ✏️ Mit KI bearbeiten
            </Link>
          )}
          {access.canEdit && (
            <Link
              href={`/projects/${id}/editor`}
              className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark"
            >
              Bearbeiten
            </Link>
          )}
        </div>
      </div>

      {access.canEdit && page && (
        <div className="mx-auto max-w-6xl px-4">
          <IngestPanel
            projectId={id}
            initialToken={project.ingest_token ?? null}
          />
        </div>
      )}

      {/* Vorschau bleibt voll breit (große Fläche). */}
      <div className="mt-6">
        {page ? (
          <CommentablePreview
            previewHtml={previewHtml}
            pageId={page.id}
            projectId={id}
            threads={threads}
            canComment={access.canComment}
            canModerate={access.canEdit}
            currentUserEmail={currentUserEmail}
            versions={versions}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
            Keine Seite vorhanden.
          </p>
        )}
      </div>
    </div>
  );
}
