"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { ingestHtmlIntoProject } from "@/lib/ingest/apply";
import {
  applyThemeInstruction,
  contextForPath,
  fetchProjectPreview,
  isFail,
  loadShopifyProject,
} from "@/lib/shopify/project";
import type { ShopifyFileMap } from "@/types/database";

export type UmsetzenResult = { ok: true } | { ok: false; error: string };

/** Setzt einen Kommentar per KI im Shopify-Theme um (nur Shopify-Projekte). */
export async function umsetzenComment(
  commentId: string,
  pageId: string,
  projectId: string,
): Promise<UmsetzenResult> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) {
    return { ok: false, error: "Keine Berechtigung zum Bearbeiten dieser Seite." };
  }

  const supabase = await createClient();

  const { data: comment } = await supabase
    .from("comments")
    .select("*")
    .eq("id", commentId)
    .single();
  if (!comment) return { ok: false, error: "Kommentar nicht gefunden." };

  const { data: page } = await supabase
    .from("pages")
    .select("*")
    .eq("id", pageId)
    .single();
  if (!page) return { ok: false, error: "Seite nicht gefunden." };

  // Shopify-Projekt: die KI ändert direkt die Theme-Dateien im Shop.
  const shop = await loadShopifyProject(projectId);
  if (isFail(shop)) return shop;
  if (shop) {
    // Kommentar auf einer anderen Shop-Seite (z. B. Kategorie) → deren Vorlage.
    const target = await contextForPath(shop, comment.page_path);
    if (!target.ok) return target;
    const res = await applyThemeInstruction(target.ctx, {
      pageHtml: target.pageHtml ?? page.template_html,
      instruction: comment.body,
    });
    if (!res.ok) return res;
    if (Object.keys(res.changed).length === 0) {
      return {
        ok: false,
        error: res.summary || "Die KI hat keine passende Stelle im Theme gefunden.",
      };
    }
    // Version = Stand der Projektseite (bei Unterseiten frisch nachladen).
    let mainHtml = page.template_html;
    if (target.pageHtml !== null) {
      const main = await fetchProjectPreview(shop);
      if (main.ok) mainHtml = main.html;
    }
    const result = await ingestHtmlIntoProject(supabase, {
      pageId,
      projectId,
      html: target.pageHtml === null ? (res.html ?? page.template_html) : mainHtml,
      filename: "shopify-vorschau.html",
      source: "umsetzen",
      label: `KI-Umsetzung: ${comment.body.slice(0, 80)}`,
      shopifyFiles: {
        ...((page.shopify_files as ShopifyFileMap) ?? {}),
        ...res.changed,
      },
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath(`/projects/${projectId}`);
    if (res.previewError) {
      return {
        ok: false,
        error: `Die Änderung ist in Shopify gespeichert, aber die Vorschau konnte nicht neu geladen werden (${res.previewError}). Bitte „Aus Shopify neu laden“ klicken.`,
      };
    }
    return { ok: true };
  }

  // HTML-Seiten setzt die Projektseite selbst um (siehe actions/studio.ts).
  return { ok: false, error: "Diese Seite wird direkt auf der Projektseite bearbeitet." };
}
