"use server";

import { revalidatePath } from "next/cache";
import { getProjectAccess } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaude, parseJson } from "@/lib/ai/claude";
import {
  aiView,
  appendCss,
  applyPatches,
  load,
  pageCss,
  pickFragment,
  replaceFragment,
  type Patch,
} from "@/lib/page/html";
import { loadPage, savePage } from "@/lib/page/store";
import type { CommentAnchor } from "@/types/database";

/**
 * Bearbeiten direkt auf der Projektseite: Änderungen von Hand (Text, Bild,
 * Ecken) und per KI. Alles setzt an den Kennungen der Elemente an, deshalb
 * wird immer nur die betroffene Stelle angefasst – nie die ganze Seite.
 */

type Fail = { ok: false; error: string };
const NO_ACCESS: Fail = { ok: false, error: "Keine Berechtigung zum Bearbeiten dieser Seite." };
const NO_PAGE: Fail = { ok: false, error: "Seite nicht gefunden." };

/** Änderungen von Hand speichern. */
export async function patchPage(
  projectId: string,
  patches: Patch[],
): Promise<{ ok: true } | Fail> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return NO_ACCESS;
  if (!Array.isArray(patches) || patches.length === 0 || patches.length > 50) {
    return { ok: false, error: "Ungültige Änderung." };
  }
  const page = await loadPage(projectId);
  if (!page) return NO_PAGE;
  const $ = load(page.html);
  const missing = applyPatches($, patches);
  if (missing.length === patches.length) {
    return { ok: false, error: "Diese Stelle gibt es nicht mehr – bitte die Seite neu laden." };
  }
  const saved = await savePage(page.id, $.html(), "auto", access.userId);
  return saved.ok ? { ok: true } : saved;
}

export interface AiEdit {
  sid: string;
  /** Neues HTML des Elements (leer = entfernt). */
  html: string;
}

export type AiEditResult =
  | { ok: true; edits: AiEdit[]; css: string; summary: string; versionNo: number | null }
  | Fail;

const SYSTEM = `You edit one SIMBA-DICKIE-GROUP marketing landing page.
You get an INSTRUCTION (usually German), the page CSS (read-only context) and an HTML EXCERPT. Every element in the excerpt carries a data-sid attribute.

Answer with JSON: {"edits":[{"sid":"…","html":"…"}],"css":"…","summary":"…","needs_whole_page":false}

Rules:
- Each edit replaces the element with that data-sid – its complete outer HTML – by "html". Pick the SMALLEST element that covers the change. Never return a large container when only a small part changes.
- Keep the data-sid attributes of every element you keep. Do not invent data-sid values for new elements.
- Insert: replace a neighbouring element by itself plus the new HTML. Delete: "html": "".
- Match the page's existing classes, structure and tone. Put new or overriding style rules into "css" (it is appended to the page stylesheet, so it wins over older rules); use inline styles only for one-off tweaks.
- Change nothing the instruction does not ask for. Keep tokens like __ASSET_0__ unchanged. No <script>.
- Never invent image URLs and never add photos of people. If a new image is needed, add a neutral placeholder block and say so in the summary – the team replaces it by hand.
- "summary": one short German sentence saying what you changed.
- If the instruction concerns parts of the page that are not in the excerpt, return no edits and set "needs_whole_page": true.
- If the instruction is unclear or nothing has to change, return no edits and explain why in "summary" (German).`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["edits", "css", "summary", "needs_whole_page"],
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sid", "html"],
        properties: { sid: { type: "string" }, html: { type: "string" } },
      },
    },
    css: { type: "string" },
    summary: { type: "string" },
    needs_whole_page: { type: "boolean" },
  },
};

interface AiAnswer {
  edits?: { sid?: unknown; html?: unknown }[];
  css?: unknown;
  summary?: unknown;
  needs_whole_page?: unknown;
}

const MAX_PAGE_CHARS = 300_000;

/**
 * Änderung per KI: entweder ein Kommentar („Umsetzen“) oder eine freie
 * Anweisung, optional an einer gewählten Stelle. Die KI sieht nur den
 * Abschnitt rund um die Stelle und liefert die geänderten Elemente zurück –
 * das geht in Sekunden. Betrifft die Anweisung mehr, wird automatisch mit der
 * ganzen Seite wiederholt.
 */
export async function aiEdit(input: {
  projectId: string;
  commentId?: string;
  instruction?: string;
  sid?: string | null;
  model?: string;
}): Promise<AiEditResult> {
  const access = await getProjectAccess(input.projectId);
  if (!access?.canEdit) return NO_ACCESS;
  const page = await loadPage(input.projectId);
  if (!page) return NO_PAGE;

  let instruction = (input.instruction ?? "").trim();
  let title = instruction;
  let sid = input.sid ?? null;
  if (input.commentId) {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("comments")
      .select("*")
      .eq("page_id", page.id)
      .or(`id.eq.${input.commentId},parent_id.eq.${input.commentId}`)
      .order("created_at");
    const main = (rows ?? []).find((c) => c.id === input.commentId);
    if (!main) return { ok: false, error: "Kommentar nicht gefunden." };
    title = main.body;
    const replies = (rows ?? []).filter((c) => c.parent_id).map((c) => `- ${c.body}`);
    instruction =
      `Feedback zur Seite, bitte umsetzen:\n${main.body}` +
      (replies.length ? `\n\nAntworten dazu (neuere gelten):\n${replies.join("\n")}` : "") +
      (instruction ? `\n\nZusatz: ${instruction}` : "");
    sid = main.anchor?.sid ?? null;
  }
  if (!instruction) return { ok: false, error: "Bitte beschreiben, was geändert werden soll." };
  const model = /^claude[\w.-]*$/.test(input.model ?? "") ? input.model : undefined;

  const $ = load(page.html);
  const css = pageCss($);

  const ask = async (scopeSid: string | null) => {
    const frag = scopeSid ? pickFragment($, scopeSid) : null;
    const view = aiView(frag ? frag.html : ($("body").html() ?? ""));
    if (view.html.length > MAX_PAGE_CHARS) {
      return {
        ok: false as const,
        error:
          "Die Seite ist für eine Änderung am Stück zu groß. Bitte die Stelle auf der Seite wählen (🎯) oder einen Kommentar an der Stelle umsetzen.",
      };
    }
    const res = await askClaude({
      system: SYSTEM,
      user:
        `INSTRUCTION:\n${instruction}\n` +
        (frag && scopeSid ? `(It refers to the element with data-sid="${scopeSid}".)\n` : "") +
        `\nPAGE CSS (read-only):\n${css}\n\n` +
        `HTML EXCERPT${frag ? "" : " (whole page body)"}:\n${view.html}`,
      maxTokens: frag ? 8000 : 16000,
      model,
      schema: SCHEMA,
    });
    if (!res.ok) return res;
    if (res.truncated) {
      return {
        ok: false as const,
        error: "Die Änderung war zu umfangreich für einen Schritt. Bitte in kleinere Schritte aufteilen.",
      };
    }
    const answer = parseJson<AiAnswer>(res.text);
    if (!answer) {
      return { ok: false as const, error: "Die KI hat kein verwertbares Ergebnis geliefert. Bitte erneut versuchen." };
    }
    return { ok: true as const, answer, restore: view.restore, scoped: !!frag };
  };

  let res = await ask(sid);
  if (res.ok && res.scoped && res.answer.needs_whole_page === true) res = await ask(null);
  if (!res.ok) return res;

  const { answer, restore } = res;
  const summary = typeof answer.summary === "string" ? answer.summary.trim() : "";
  const edits: AiEdit[] = [];
  for (const e of Array.isArray(answer.edits) ? answer.edits : []) {
    if (typeof e?.sid !== "string" || typeof e.html !== "string") continue;
    const html = replaceFragment($, e.sid, restore(e.html));
    if (html !== null) edits.push({ sid: e.sid, html });
  }
  const newCss = typeof answer.css === "string" ? answer.css.trim() : "";
  if (newCss) appendCss($, newCss);
  if (edits.length === 0 && !newCss) {
    return {
      ok: false,
      error: summary
        ? `Nichts geändert – ${summary}`
        : "Die KI hat keine passende Stelle gefunden. Bitte die Anweisung genauer fassen.",
    };
  }

  const saved = await savePage(page.id, $.html(), {
    source: input.commentId ? "umsetzen" : "ki",
    label: `Vor KI-Änderung: ${title.replace(/\s+/g, " ").slice(0, 80)}`,
    userId: access.userId,
  });
  if (!saved.ok) return saved;
  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true, edits, css: newCss, summary: summary || "Geändert.", versionNo: saved.versionNo };
}

/** Aktuelles HTML der Seite (z. B. nach dem Wiederherstellen einer Version). */
export async function currentHtml(projectId: string): Promise<{ ok: true; html: string } | Fail> {
  const access = await getProjectAccess(projectId);
  if (!access?.role) return NO_ACCESS;
  const page = await loadPage(projectId);
  return page ? { ok: true, html: page.html } : NO_PAGE;
}

/** KI-Änderung zurücknehmen: Stand der Sicherung zurückholen, Sicherung löschen. */
export async function undoAi(
  projectId: string,
  versionNo: number,
): Promise<{ ok: true; html: string } | Fail> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return NO_ACCESS;
  const page = await loadPage(projectId);
  if (!page) return NO_PAGE;
  const admin = createAdminClient();
  const { data: version } = await admin
    .from("page_versions")
    .select("id, template_html, detected_elements, content_state")
    .eq("page_id", page.id)
    .eq("version_no", versionNo)
    .maybeSingle();
  if (!version) return { ok: false, error: "Die Sicherung gibt es nicht mehr." };
  const { error } = await admin
    .from("pages")
    .update({
      template_html: version.template_html,
      detected_elements: version.detected_elements,
      content_state: version.content_state,
    })
    .eq("id", page.id);
  if (error) return { ok: false, error: "Zurücknehmen fehlgeschlagen." };
  await admin.from("page_versions").delete().eq("id", version.id);
  revalidatePath(`/projects/${projectId}`);
  return currentHtml(projectId);
}

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/**
 * Bild-Upload vorbereiten: Das Bild geht vom Browser DIREKT in den Speicher
 * (keine Größengrenze des Hostings) und bekommt eine dauerhafte Adresse.
 */
export async function prepareImageUpload(
  projectId: string,
  contentType: string,
  size: number,
): Promise<{ ok: true; path: string; token: string; url: string } | Fail> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return NO_ACCESS;
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return { ok: false, error: "Nicht unterstütztes Bildformat (erlaubt: JPG, PNG, WebP, GIF, SVG)." };
  if (size > 25 * 1024 * 1024) return { ok: false, error: "Bild ist zu groß (max. 25 MB)." };
  const bucket = createAdminClient().storage.from("ki-assets");
  const { data, error } = await bucket.createSignedUploadUrl(`${projectId}/${crypto.randomUUID()}.${ext}`);
  if (error || !data) {
    return {
      ok: false,
      error: `Upload konnte nicht vorbereitet werden${error?.message ? ` (${error.message})` : ""}.`,
    };
  }
  return { ok: true, path: data.path, token: data.token, url: bucket.getPublicUrl(data.path).data.publicUrl };
}

/** Ältere Kommentare nachträglich an ihr Element heften (einmalig). */
export async function saveAnchors(
  projectId: string,
  anchors: { id: string; anchor: CommentAnchor }[],
): Promise<void> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return;
  const page = await loadPage(projectId);
  if (!page) return;
  const admin = createAdminClient();
  await Promise.all(
    anchors.slice(0, 200).map(({ id, anchor }) =>
      admin
        .from("comments")
        .update({ anchor: { sid: String(anchor.sid), dx: Number(anchor.dx) || 0, dy: Number(anchor.dy) || 0 } })
        .eq("id", id)
        .eq("page_id", page.id),
    ),
  );
}
