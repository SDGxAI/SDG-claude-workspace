"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { renderHtml } from "@/lib/html/render";
import { resolveImages } from "@/lib/storage";
import { getProjectAccess } from "@/lib/access";
import {
  isFail,
  loadShopifyProject,
  resolveState,
  writeThemeState,
} from "@/lib/shopify/project";
import type {
  ContentState,
  Database,
  DetectedElement,
  PageVersionSource,
  ShopifyFileMap,
  StoredComment,
} from "@/types/database";

/**
 * Baut aus den Kommentar-Zeilen einer Seite eine denormalisierte
 * Momentaufnahme (mit Autor-E-Mails, Threads), die in einer Version
 * festgehalten wird.
 */
async function buildCommentsSnapshot(
  client: SupabaseClient<Database>,
  pageId: string,
): Promise<StoredComment[]> {
  const { data: comments } = await client
    .from("comments")
    .select("id, parent_id, author_id, body, x_pct, y_pct, status, created_at")
    .eq("page_id", pageId)
    .order("created_at", { ascending: true });
  if (!comments || comments.length === 0) return [];

  const authorIds = [
    ...new Set(comments.map((c) => c.author_id).filter((v): v is string => !!v)),
  ];
  const emailById = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, email")
      .in("id", authorIds);
    (profiles ?? []).forEach((p) => emailById.set(p.id, p.email));
  }
  const emailOf = (id: string | null) =>
    (id && emailById.get(id)) || "Unbekannt";

  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesByParent = new Map<string, typeof comments>();
  for (const c of comments) {
    if (c.parent_id) {
      const list = repliesByParent.get(c.parent_id) ?? [];
      list.push(c);
      repliesByParent.set(c.parent_id, list);
    }
  }

  return topLevel.map((c) => ({
    id: c.id,
    body: c.body,
    xPct: Number(c.x_pct),
    yPct: Number(c.y_pct),
    status: c.status,
    createdAt: c.created_at,
    authorEmail: emailOf(c.author_id),
    replies: (repliesByParent.get(c.id) ?? []).map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      authorEmail: emailOf(r.author_id),
    })),
  }));
}

/** Metadaten einer archivierten Version (ohne den schweren HTML-Inhalt). */
export interface VersionMeta {
  id: string;
  versionNo: number;
  label: string | null;
  source: PageVersionSource;
  createdAt: string;
  authorEmail: string | null;
}

// Deckt sowohl den Session-Client (SSR) als auch den Admin-Client
// (service_role, für die API-Schnittstelle) ab.
type SupabaseServerClient = SupabaseClient<Database>;

/**
 * Archiviert den AKTUELLEN Stand einer Seite als neue Version. Wird vor dem
 * Überschreiben (Claude-Import, KI-Umsetzung) und beim manuellen
 * „Version speichern" aufgerufen. Liest die Seite frisch aus der DB, damit
 * immer der echte aktuelle Stand gesichert wird.
 *
 * Optional kann ein bereits vorhandener Client übergeben werden (z. B. der
 * Admin-Client der API-Schnittstelle), sonst wird der normale Server-Client
 * mit der Session der eingeloggten Person genutzt.
 */
export async function archiveCurrentAsVersion(
  pageId: string,
  source: PageVersionSource,
  label: string | null,
  client?: SupabaseServerClient,
  createdBy?: string | null,
): Promise<{ ok: true; versionNo: number } | { ok: false; error: string }> {
  const supabase = client ?? (await createClient());

  // „*“, damit auch der Shopify-Stand (Migration 0015) mitkommt, ohne dass
  // ältere Datenbanken ohne diese Spalte einen Fehler werfen.
  const { data: page } = await supabase
    .from("pages")
    .select("*")
    .eq("id", pageId)
    .single();
  if (!page) return { ok: false, error: "Seite nicht gefunden." };

  const { data: nextNo } = await supabase.rpc("next_page_version_no", {
    p_page_id: pageId,
  });
  const versionNo = typeof nextNo === "number" ? nextNo : 1;

  const commentsSnapshot = await buildCommentsSnapshot(supabase, pageId);

  const { error } = await supabase.from("page_versions").insert({
    page_id: pageId,
    version_no: versionNo,
    label,
    source,
    template_html: page.template_html,
    detected_elements: page.detected_elements as DetectedElement[],
    content_state: page.content_state as ContentState,
    comments_snapshot: commentsSnapshot,
    created_by: createdBy ?? null,
    ...(page.shopify_files && Object.keys(page.shopify_files).length > 0
      ? { shopify_files: page.shopify_files }
      : {}),
  });
  if (error) {
    return { ok: false, error: "Version konnte nicht gespeichert werden." };
  }
  return { ok: true, versionNo };
}

/**
 * Speichert den aktuellen Stand ausdrücklich als Version (Knopf „Version
 * speichern"). Editorrecht wird per RLS erzwungen.
 */
export async function saveVersion(
  pageId: string,
  projectId: string,
  label?: string,
): Promise<{ ok: true; versionNo: number } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const res = await archiveCurrentAsVersion(
    pageId,
    "manual",
    label?.trim() ? label.trim().slice(0, 120) : null,
    supabase,
    user?.id ?? null,
  );
  if (res.ok) revalidatePath(`/projects/${projectId}`);
  return res;
}

/** Liste der Versionen einer Seite (neueste zuerst), nur Metadaten. */
export async function listVersions(pageId: string): Promise<VersionMeta[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("page_versions")
    .select("id, version_no, label, source, created_at, created_by")
    .eq("page_id", pageId)
    .order("version_no", { ascending: false });

  const rows = data ?? [];
  const authorIds = [
    ...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v)),
  ];
  const emailById = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", authorIds);
    (profiles ?? []).forEach((p) => emailById.set(p.id, p.email));
  }

  return rows.map((r) => ({
    id: r.id,
    versionNo: r.version_no,
    label: r.label,
    source: r.source as PageVersionSource,
    createdAt: r.created_at,
    authorEmail: r.created_by ? emailById.get(r.created_by) ?? null : null,
  }));
}

/**
 * Fertig gerendertes HTML einer archivierten Version (mit signierten
 * Bild-URLs) – für die Vorschau/den Vergleich alter Stände.
 */
export async function getVersionHtml(
  versionId: string,
): Promise<
  | { ok: true; html: string; comments: StoredComment[] }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const { data: version } = await supabase
    .from("page_versions")
    .select("template_html, detected_elements, content_state, comments_snapshot")
    .eq("id", versionId)
    .single();
  if (!version) return { ok: false, error: "Version nicht gefunden." };

  const contentState = version.content_state as ContentState;
  const resolvedImages = await resolveImages(supabase, contentState.images);
  const html = renderHtml(
    version.template_html,
    { ...contentState, images: resolvedImages },
    version.detected_elements as DetectedElement[],
  );
  return {
    ok: true,
    html,
    comments: (version.comments_snapshot as StoredComment[]) ?? [],
  };
}

/** Löscht eine archivierte Version (Editor/Admin – per RLS erzwungen). */
export async function deleteVersion(
  versionId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("page_versions")
    .delete()
    .eq("id", versionId);
  if (error) {
    return { ok: false, error: "Version konnte nicht gelöscht werden." };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/**
 * Stellt eine ältere Version als aktuellen Stand wieder her. Der bisherige
 * aktuelle Stand wird zuvor als Version archiviert, damit nichts verloren geht.
 */
export async function restoreVersion(
  versionId: string,
  pageId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: version } = await supabase
    .from("page_versions")
    .select("*")
    .eq("id", versionId)
    .single();
  if (!version) return { ok: false, error: "Version nicht gefunden." };

  // Shopify-Projekt: zuerst die Theme-Dateien im Shop auf den Stand der
  // Version zurücksetzen (alles, was Sites je geändert hat).
  const shop = await loadShopifyProject(projectId);
  if (isFail(shop)) return shop;
  let shopifyFiles: ShopifyFileMap | undefined;
  if (shop) {
    const access = await getProjectAccess(projectId);
    if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung." };
    const { data: current } = await supabase
      .from("pages")
      .select("*")
      .eq("id", pageId)
      .single();
    const currentFiles = (current?.shopify_files as ShopifyFileMap) ?? {};
    const versionFiles = (version.shopify_files as ShopifyFileMap | null) ?? {};
    const keys = new Set([...Object.keys(currentFiles), ...Object.keys(versionFiles)]);
    shopifyFiles = resolveState(keys, versionFiles, shop.baseline);
    const written = await writeThemeState(shop, shopifyFiles);
    if (!written.ok) return written;
  }

  // Aktuellen Stand sichern, bevor er überschrieben wird.
  await archiveCurrentAsVersion(
    pageId,
    "editor",
    "Automatisch vor Wiederherstellung gesichert",
    supabase,
    user?.id ?? null,
  );

  const { error } = await supabase
    .from("pages")
    .update({
      template_html: version.template_html,
      detected_elements: version.detected_elements,
      content_state: version.content_state,
      ...(shopifyFiles ? { shopify_files: shopifyFiles } : {}),
    })
    .eq("id", pageId);
  if (error) {
    return { ok: false, error: "Wiederherstellen fehlgeschlagen." };
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/editor`);
  return { ok: true };
}
