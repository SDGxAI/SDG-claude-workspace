import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
import { resolveImages } from "@/lib/storage";
import { StatusSelect } from "@/components/projects/StatusSelect";
import { PageContainer } from "@/components/PageContainer";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/status";
import type { ContentState, DetectedElement } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const access = await getProjectAccess(id);
  if (!access) redirect("/login");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (!project) notFound();

  const { data: page } = await supabase
    .from("pages")
    .select("template_html, content_state, detected_elements")
    .eq("project_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  let previewHtml =
    "<p style=\"font-family:sans-serif;padding:2rem\">Keine Seite vorhanden.</p>";
  if (page) {
    const contentState = page.content_state as ContentState;
    const resolvedImages = await resolveImages(supabase, contentState.images);
    previewHtml = renderHtml(
      page.template_html,
      { ...contentState, images: resolvedImages },
      page.detected_elements as DetectedElement[],
    );
  }

  return (
    <PageContainer>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/projects"
            className="text-sm text-neutral-500 hover:text-sdg-red"
          >
            ← Projekte
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
            {project.title}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
            <span>{project.brand}</span>
            <span>·</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[project.status]}`}
            >
              {STATUS_LABELS[project.status]}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {access.isAdmin && (
            <StatusSelect projectId={id} currentStatus={project.status} />
          )}
          {access.canEdit ? (
            <Link
              href={`/projects/${id}/editor`}
              className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark"
            >
              Bearbeiten
            </Link>
          ) : (
            <Link
              href={`/projects/${id}/editor`}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red"
            >
              Ansehen
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
          Vorschau
        </div>
        <iframe
          title="Vorschau"
          srcDoc={previewHtml}
          className="h-[70vh] w-full"
          sandbox="allow-same-origin"
        />
      </div>
    </PageContainer>
  );
}
