import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHtmlTemplate } from "@/lib/html/parse";
import { archiveCurrentAsVersion } from "@/lib/actions/versions";
import type { Database, PageVersionSource } from "@/types/database";

export type IngestResult =
  | { ok: true; versionNo: number | null }
  | { ok: false; error: string };

/**
 * Ersetzt die aktuelle Seite eines Projekts durch neues HTML: sichert den
 * bisherigen Stand als Version und schreibt danach die neu geparsten Inhalte.
 *
 * Wird von der Claude-Schnittstelle (POST /api/ingest) genutzt und nutzt den
 * übergebenen Client (dort der Admin-/service_role-Client). Die eigentliche
 * Rechteprüfung passiert vor dem Aufruf (gültiger Update-Schlüssel).
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
  },
): Promise<IngestResult> {
  if (!input.html.trim() || !/<[a-z][\s\S]*>/i.test(input.html)) {
    return { ok: false, error: "Kein gültiges HTML übergeben." };
  }

  let parsed;
  try {
    parsed = parseHtmlTemplate(input.html);
  } catch {
    return { ok: false, error: "Das HTML konnte nicht analysiert werden." };
  }

  // Bisherigen Stand als Version sichern (nur wenn schon Inhalt da ist –
  // ein Fehler hier darf den Import nicht verhindern).
  let versionNo: number | null = null;
  const archived = await archiveCurrentAsVersion(
    input.pageId,
    input.source,
    input.label ?? null,
    client,
    null,
  );
  if (archived.ok) versionNo = archived.versionNo;

  const { error } = await client
    .from("pages")
    .update({
      template_html: parsed.templateHtml,
      detected_elements: parsed.detectedElements,
      content_state: parsed.contentState,
      original_filename: (input.filename ?? "claude-update.html").slice(0, 200),
    })
    .eq("id", input.pageId);

  if (error) {
    return { ok: false, error: "Die Seite konnte nicht aktualisiert werden." };
  }
  return { ok: true, versionNo };
}
