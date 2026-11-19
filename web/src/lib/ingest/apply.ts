import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveCurrentAsVersion } from "@/lib/actions/versions";
import { EMPTY_STATE, prepareHtml } from "@/lib/page/store";
import type { Database, PageVersionSource, ShopifyFileMap } from "@/types/database";

export type IngestResult =
  | { ok: true; versionNo: number | null }
  | { ok: false; error: string };

/**
 * Ersetzt die aktuelle Seite eines Projekts durch neues HTML: sichert den
 * bisherigen Stand als Version und speichert danach die neue Seite. Elemente,
 * die gleich geblieben sind, behalten ihre Kennung – Kommentare bleiben so an
 * ihrer Stelle.
 *
 * Die Rechteprüfung passiert vor dem Aufruf (z. B. gültiger Update-Schlüssel).
 */
export async function ingestHtmlIntoProject(
  client: SupabaseClient<Database>,
  input: {
    pageId: string;
    projectId: string;
    html: string;
    filename?: string;
    source: PageVersionSource;
    label?: string | null;
    /** Nur Shopify-Projekte: Stand der von Sites geänderten Theme-Dateien. */
    shopifyFiles?: ShopifyFileMap;
  },
): Promise<IngestResult> {
  if (!input.html.trim() || !/<[a-z][\s\S]*>/i.test(input.html)) {
    return { ok: false, error: "Kein gültiges HTML übergeben." };
  }
  const { data: current } = await client
    .from("pages")
    .select("template_html")
    .eq("id", input.pageId)
    .maybeSingle();

  let html: string;
  try {
    html = await prepareHtml(input.projectId, input.html, current?.template_html);
  } catch {
    return { ok: false, error: "Das HTML konnte nicht analysiert werden." };
  }

  // Bisherigen Stand sichern (ein Fehler hier darf den Import nicht verhindern).
  const archived = await archiveCurrentAsVersion(
    input.pageId,
    input.source,
    input.label ?? null,
    client,
    null,
  );

  const { error } = await client
    .from("pages")
    .update({
      template_html: html,
      detected_elements: [],
      content_state: EMPTY_STATE,
      original_filename: (input.filename ?? "claude-update.html").slice(0, 200),
      ...(input.shopifyFiles ? { shopify_files: input.shopifyFiles } : {}),
    })
    .eq("id", input.pageId);
  if (error) return { ok: false, error: "Die Seite konnte nicht aktualisiert werden." };
  return { ok: true, versionNo: archived.ok ? archived.versionNo : null };
}
