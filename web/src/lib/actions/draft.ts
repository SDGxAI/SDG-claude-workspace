"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
import { editHtmlWithAI, type Effort } from "@/lib/ai/editHtml";
import { ingestHtmlIntoProject } from "@/lib/ingest/apply";
import { createNotification } from "@/lib/actions/notifications";
import {
  applyThemeInstruction,
  contextForPath,
  fetchProjectPreview,
  isFail,
  loadShopifyProject,
  resolveState,
  uploadImagesToShopify,
  writeThemeState,
} from "@/lib/shopify/project";
import type {
  ContentState,
  DetectedElement,
  DraftMessage,
  ShopifyFileMap,
} from "@/types/database";

export interface DraftState {
  html: string;
  messages: DraftMessage[];
}

type DraftResult =
  | { ok: true; draft: DraftState }
  | { ok: false; error: string };

/** Aktuellen Live-Stand als Start-HTML eines Entwurfs rendern. */
async function renderCurrentHtml(pageId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: page } = await supabase
    .from("pages")
    .select("template_html, content_state, detected_elements")
    .eq("id", pageId)
    .single();
  if (!page) return null;
  return renderHtml(
    page.template_html,
    page.content_state as ContentState,
    page.detected_elements as DetectedElement[],
  );
}

/** Vorhandenen Entwurf laden oder aus dem aktuellen Stand neu anlegen. */
export async function getOrStartDraft(
  pageId: string,
  projectId: string,
): Promise<DraftResult> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("page_drafts")
    .select("html, messages")
    .eq("page_id", pageId)
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      draft: {
        html: existing.html,
        messages: (existing.messages as DraftMessage[]) ?? [],
      },
    };
  }

  const startHtml = await renderCurrentHtml(pageId);
  if (startHtml === null) return { ok: false, error: "Seite nicht gefunden." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("page_drafts").insert({
    page_id: pageId,
    html: startHtml,
    messages: [],
    updated_by: user?.id ?? null,
  });
  if (error) return { ok: false, error: "Entwurf konnte nicht angelegt werden." };

  return {
    ok: true,
    draft: {
      html: startHtml,
      messages: [],
    },
  };
}

/** Eine Anweisung (Freitext + ausgewählte Kommentare) auf den Entwurf anwenden. */
export async function sendDraftInstruction(
  pageId: string,
  projectId: string,
  freeText: string,
  commentIds: string[],
  assetUrls: string[] = [],
  model?: string,
  effort?: Effort,
  /** Shopify: Seite im Shop, die gerade angezeigt wird (leer = Projektseite). */
  pagePath?: string | null,
): Promise<DraftResult> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung." };

  const supabase = await createClient();
  const { data: draft } = await supabase
    .from("page_drafts")
    .select("*")
    .eq("page_id", pageId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Kein Entwurf vorhanden. Bitte neu öffnen." };

  const shop = await loadShopifyProject(projectId);
  if (isFail(shop)) return shop;

  // Ausgewählte Kommentare laden.
  let commentLines: string[] = [];
  let commentPaths: string[] = [];
  if (commentIds.length > 0) {
    const { data: comments } = await supabase
      .from("comments")
      .select("*")
      .in("id", commentIds);
    commentLines = (comments ?? []).map((c) => `- ${c.body}`);
    commentPaths = [...new Set((comments ?? []).map((c) => c.page_path).filter((p): p is string => !!p))];
  }

  const parts: string[] = [];
  if (freeText.trim()) parts.push(freeText.trim());
  if (commentLines.length > 0) {
    parts.push(
      `Setze außerdem dieses Feedback um:\n${commentLines.join("\n")}`,
    );
  }
  if (assetUrls.length > 0 && shop) {
    // Shopify-Themes brauchen Bilder aus den Shopify-Dateien.
    const uploaded = await uploadImagesToShopify(shop, assetUrls);
    if (!uploaded.ok) return uploaded;
    parts.push(
      "Neu hochgeladene Bilder (als image_picker-Wert verwenden, wo in der Anweisung beschrieben):\n" +
        uploaded.refs.map((r, i) => `Bild ${i + 1}: ${r}`).join("\n"),
    );
  } else if (assetUrls.length > 0) {
    parts.push(
      "Verfügbare hochgeladene Bilder (als <img src> einsetzen, wo in der Anweisung beschrieben):\n" +
        assetUrls.map((u, i) => `Bild ${i + 1}: ${u}`).join("\n"),
    );
  }
  const instruction = parts.join("\n\n");
  if (!instruction) return { ok: false, error: "Bitte eine Anweisung eingeben oder Kommentare auswählen." };

  let edited: { ok: true; html: string; summary?: string } | { ok: false; error: string };
  let shopifyFiles: ShopifyFileMap | undefined;
  if (shop) {
    // Änderung landet sofort im Vorschau-Theme; Sites merkt sich den Stand.
    const { data: page } = await supabase
      .from("pages")
      .select("*")
      .eq("id", pageId)
      .single();
    const working =
      (draft.shopify_files as ShopifyFileMap | null) ??
      ((page?.shopify_files as ShopifyFileMap) ?? {});
    // Welche Shop-Seite? Die gerade angezeigte, sonst die der gewählten
    // Kommentare (wenn alle auf derselben Unterseite liegen).
    const targetPath = pagePath || (commentPaths.length === 1 ? commentPaths[0] : null);
    const target = await contextForPath(shop, targetPath);
    if (!target.ok) return target;
    const res = await applyThemeInstruction(target.ctx, {
      pageHtml: target.pageHtml ?? draft.html,
      instruction,
      model,
      effort,
    });
    if (!res.ok) return res;
    // Entwurf zeigt immer den Stand der Projektseite.
    if (target.pageHtml !== null && Object.keys(res.changed).length > 0) {
      const main = await fetchProjectPreview(shop);
      res.html = main.ok ? main.html : null;
    }
    shopifyFiles = { ...working, ...res.changed };
    const nothing = Object.keys(res.changed).length === 0;
    edited = {
      ok: true,
      html: res.html ?? draft.html,
      summary: nothing
        ? res.summary || "Dazu habe ich im Theme keine passende Stelle gefunden."
        : res.previewError
          ? `${res.summary} (In Shopify gespeichert – die Vorschau konnte aber nicht neu geladen werden: ${res.previewError})`
          : res.summary,
    };
  } else {
    edited = await editHtmlWithAI(draft.html, instruction, model, effort);
  }
  if (!edited.ok) return { ok: false, error: edited.error };

  const now = new Date().toISOString();
  const userVisible =
    (freeText.trim() ? freeText.trim() : "") +
    (commentLines.length > 0
      ? `${freeText.trim() ? "\n\n" : ""}Kommentare übernommen:\n${commentLines.join("\n")}`
      : "") +
    (assetUrls.length > 0
      ? `${freeText.trim() || commentLines.length > 0 ? "\n\n" : ""}📷 ${assetUrls.length} Bild(er) hochgeladen`
      : "");
  const messages: DraftMessage[] = [
    ...((draft.messages as DraftMessage[]) ?? []),
    { role: "user", content: userVisible, at: now },
    {
      role: "assistant",
      content: edited.summary?.trim()
        ? edited.summary.trim()
        : "Übernommen – schau dir die Vorschau an.",
      at: now,
    },
  ];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("page_drafts")
    .update({
      html: edited.html,
      messages,
      updated_by: user?.id ?? null,
      ...(shopifyFiles ? { shopify_files: shopifyFiles } : {}),
    })
    .eq("page_id", pageId);
  if (error) return { ok: false, error: "Entwurf konnte nicht gespeichert werden." };

  return {
    ok: true,
    draft: {
      html: edited.html,
      messages,
    },
  };
}

/** Aktuellen Entwurfs-Stand (HTML) frisch aus der DB holen. */
export async function refreshDraftHtml(
  pageId: string,
  projectId: string,
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("page_drafts")
    .select("html")
    .eq("page_id", pageId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Kein Entwurf vorhanden." };
  return { ok: true, html: data.html };
}

/** Entwurf verwerfen (löschen). */
export async function discardDraft(
  pageId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung." };
  const supabase = await createClient();

  // Shopify: bereits ins Theme geschriebene Entwurfs-Änderungen zurücknehmen.
  const shop = await loadShopifyProject(projectId);
  if (isFail(shop)) return shop;
  if (shop) {
    const [{ data: draft }, { data: page }] = await Promise.all([
      supabase.from("page_drafts").select("*").eq("page_id", pageId).maybeSingle(),
      supabase.from("pages").select("*").eq("id", pageId).single(),
    ]);
    const draftFiles = (draft?.shopify_files as ShopifyFileMap | null) ?? {};
    if (Object.keys(draftFiles).length > 0) {
      const committed = (page?.shopify_files as ShopifyFileMap) ?? {};
      const target = resolveState(Object.keys(draftFiles), committed, shop.baseline);
      const written = await writeThemeState(shop, target);
      if (!written.ok) {
        return {
          ok: false,
          error: `Die Änderungen im Shopify-Theme konnten nicht zurückgesetzt werden: ${written.error}`,
        };
      }
    }
  }

  const { error } = await supabase
    .from("page_drafts")
    .delete()
    .eq("page_id", pageId);
  if (error) return { ok: false, error: "Entwurf konnte nicht verworfen werden." };
  return { ok: true };
}

/**
 * Entwurf als neue aktuelle Version speichern: alten Stand archivieren, den
 * Entwurf übernehmen, die einbezogenen Kommentare erledigen (mit Mitteilung)
 * und den Entwurf löschen.
 */
export async function commitDraft(
  pageId: string,
  projectId: string,
  resolvedCommentIds: string[],
  label?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: draft } = await supabase
    .from("page_drafts")
    .select("*")
    .eq("page_id", pageId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Kein Entwurf vorhanden." };

  const draftFiles = draft.shopify_files as ShopifyFileMap | null | undefined;
  const result = await ingestHtmlIntoProject(supabase, {
    pageId,
    projectId,
    html: draft.html,
    source: "ki",
    label: label?.trim() ? label.trim().slice(0, 120) : "KI-Bearbeitung",
    ...(draftFiles ? { shopifyFiles: draftFiles } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Einbezogene Kommentare erledigen + Autor:innen benachrichtigen.
  if (resolvedCommentIds.length > 0) {
    const admin = createAdminClient();
    const { data: comments } = await supabase
      .from("comments")
      .select("id, author_id, body, status")
      .in("id", resolvedCommentIds);

    await supabase
      .from("comments")
      .update({ status: "erledigt" })
      .in("id", resolvedCommentIds);

    const { data: project } = await admin
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .maybeSingle();

    for (const c of comments ?? []) {
      if (c.author_id && c.author_id !== user?.id && c.status !== "erledigt") {
        const excerpt =
          c.body.length > 80 ? `${c.body.slice(0, 80)}…` : c.body;
        await createNotification(admin, {
          userId: c.author_id,
          type: "comment_done",
          body: `Dein Kommentar wurde umgesetzt${
            project?.title ? ` (Projekt „${project.title}“)` : ""
          }: „${excerpt}“`,
          projectId,
          commentId: c.id,
        });
      }
    }
  }

  await supabase.from("page_drafts").delete().eq("page_id", pageId);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/editor`);
  return { ok: true };
}
