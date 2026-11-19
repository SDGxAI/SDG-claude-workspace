import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderHtml } from "@/lib/html/render";
import { IMAGE_BUCKET, isStorageRef, toStoragePath } from "@/lib/storage";
import { externalizeInlineImages, hasLargeInlineImages } from "@/lib/images/externalize";
import { archiveCurrentAsVersion } from "@/lib/actions/versions";
import { load, stampSids } from "@/lib/page/html";
import type { ContentState, DetectedElement, PageVersionSource } from "@/types/database";

/**
 * Laden und Speichern von Seiten. Eine Seite ist genau EINE HTML-Datei (Spalte
 * template_html) mit Kennungen an den Elementen. Seiten aus der Zeit davor
 * (Vorlage + getrennte Inhalte) werden beim ersten Öffnen einmalig umgestellt.
 */

export const EMPTY_STATE: ContentState = { colors: {}, texts: {}, images: {} };
const AUTO_VERSION_MS = 10 * 60 * 1000;

export interface FlatPage {
  id: string;
  html: string;
}

/** HTML einheitlich aufbereiten: Bilder auslagern, Kennungen vergeben. */
export async function prepareHtml(projectId: string, html: string, previous?: string): Promise<string> {
  let out = html.replace(/\sdata-edit-id="[^"]*"/g, "");
  if (hasLargeInlineImages(out)) {
    out = (await externalizeInlineImages(projectId, [out])).replace(out);
  }
  const $ = load(out);
  stampSids($, previous);
  return $.html();
}

/** Alte Bild-Verweise (privater Speicher) dauerhaft erreichbar machen. */
async function publishImages(projectId: string, images: Record<string, string>) {
  const admin = createAdminClient();
  const out = { ...images };
  await Promise.all(
    Object.entries(images).map(async ([id, value]) => {
      if (!isStorageRef(value)) return;
      const path = toStoragePath(value);
      const { data: file } = await admin.storage.from(IMAGE_BUCKET).download(path);
      if (!file) return;
      const target = `${projectId}/img/${path.split("/").pop()}`;
      const { error } = await admin.storage
        .from("ki-assets")
        .upload(target, file, { contentType: file.type || undefined, upsert: true });
      if (!error) out[id] = admin.storage.from("ki-assets").getPublicUrl(target).data.publicUrl;
    }),
  );
  return out;
}

/** Aktuelle Seite eines Projekts als eine HTML-Datei (stellt Altbestand um). */
export async function loadPage(projectId: string): Promise<FlatPage | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("pages")
    .select("id, template_html, content_state, detected_elements")
    .eq("project_id", projectId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!row) return null;

  const state = (row.content_state ?? EMPTY_STATE) as ContentState;
  const detected = (row.detected_elements ?? []) as DetectedElement[];
  const legacy = detected.length > 0 || /\sdata-edit-id="/.test(row.template_html);
  const ready =
    !legacy && /\sdata-sid="/.test(row.template_html) && !hasLargeInlineImages(row.template_html);
  if (ready) return { id: row.id, html: row.template_html };

  let html = row.template_html;
  if (legacy) {
    const images = await publishImages(projectId, state.images ?? {});
    html = renderHtml(row.template_html, { ...state, images }, detected);
  }
  html = await prepareHtml(projectId, html);
  await admin
    .from("pages")
    .update({ template_html: html, detected_elements: [], content_state: EMPTY_STATE })
    .eq("id", row.id);
  return { id: row.id, html };
}

/**
 * Seite speichern. Vorher wird der bisherige Stand als Version gesichert:
 * bei `archive: "auto"` nur, wenn die letzte Version älter als 10 Minuten ist
 * (ein Sicherungspunkt je Bearbeitungs-Sitzung statt je Tastendruck).
 */
export async function savePage(
  pageId: string,
  html: string,
  archive: { source: PageVersionSource; label: string | null; userId: string | null } | "auto" | null,
  userId: string | null = null,
): Promise<{ ok: true; versionNo: number | null } | { ok: false; error: string }> {
  const admin = createAdminClient();
  let versionNo: number | null = null;
  let plan = archive === "auto" ? null : archive;
  if (archive === "auto") {
    const { data: last } = await admin
      .from("page_versions")
      .select("created_at")
      .eq("page_id", pageId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || Date.now() - new Date(last.created_at).getTime() > AUTO_VERSION_MS) {
      plan = { source: "editor", label: "Automatisch vor dem Bearbeiten gesichert", userId };
    }
  }
  if (plan) {
    const res = await archiveCurrentAsVersion(pageId, plan.source, plan.label, admin, plan.userId);
    if (res.ok) versionNo = res.versionNo;
  }
  const { error } = await admin
    .from("pages")
    .update({ template_html: html, detected_elements: [], content_state: EMPTY_STATE })
    .eq("id", pageId);
  if (error) return { ok: false, error: "Die Seite konnte nicht gespeichert werden." };
  return { ok: true, versionNo };
}
