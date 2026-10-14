import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadConnection, type Fail, type ShopifyConnection } from "@/lib/shopify/client";
import { editShopifyThemeWithAI } from "@/lib/shopify/aiTheme";
import { createShopImage, upsertThemeFiles } from "@/lib/shopify/themes";
import { fetchThemePreviewHtml } from "@/lib/shopify/storefront";
import type { Effort } from "@/lib/ai/editHtml";
import type { ShopifyFileMap } from "@/types/database";

export interface ShopifyProjectContext {
  projectId: string;
  conn: ShopifyConnection;
  themeId: string;
  themeName: string | null;
  path: string;
  template: string;
  baseline: ShopifyFileMap;
}

/**
 * Lädt die Shopify-Daten eines Projekts. Gibt null zurück, wenn das Projekt
 * aus einer HTML-Datei stammt (dann gilt der normale Ablauf). Die
 * Rechteprüfung muss VOR dem Aufruf passieren.
 */
export async function loadShopifyProject(
  projectId: string,
): Promise<ShopifyProjectContext | null | Fail> {
  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.source !== "shopify") return null;
  if (!project.shopify_connection_id || !project.shopify_theme_id) {
    return { ok: false, error: "Die Shopify-Verbindung dieses Projekts fehlt. Bitte unter „Shopify“ prüfen." };
  }
  const conn = await loadConnection(project.shopify_connection_id);
  if (!conn) {
    return { ok: false, error: "Der verbundene Shop wurde in Sites entfernt. Bitte neu verbinden." };
  }
  return {
    projectId,
    conn,
    themeId: project.shopify_theme_id,
    themeName: project.shopify_theme_name ?? null,
    path: project.shopify_path || "/",
    template: project.shopify_template || "templates/index.json",
    baseline: (project.shopify_baseline as ShopifyFileMap) ?? {},
  };
}

export function isFail(v: unknown): v is Fail {
  return typeof v === "object" && v !== null && (v as Fail).ok === false;
}

/** Originalinhalte merken, bevor eine Datei zum ersten Mal geändert wird. */
async function rememberBaseline(ctx: ShopifyProjectContext, originals: ShopifyFileMap) {
  const missing = Object.entries(originals).filter(([k]) => !(k in ctx.baseline));
  if (missing.length === 0) return;
  ctx.baseline = { ...ctx.baseline, ...Object.fromEntries(missing) };
  await createAdminClient()
    .from("projects")
    .update({ shopify_baseline: ctx.baseline })
    .eq("id", ctx.projectId);
}

/** Aktuelle Vorschau der Seite aus dem Shop holen (ein Wiederholversuch). */
export async function fetchProjectPreview(
  ctx: ShopifyProjectContext,
): Promise<{ ok: true; html: string } | Fail> {
  let res = await fetchThemePreviewHtml(ctx.conn, ctx.themeId, ctx.path);
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetchThemePreviewHtml(ctx.conn, ctx.themeId, ctx.path);
  }
  return res;
}

/** Hochgeladene Bilder (öffentliche URLs) als Shopify-Dateien anlegen. */
export async function uploadImagesToShopify(
  ctx: ShopifyProjectContext,
  urls: string[],
): Promise<{ ok: true; refs: string[] } | Fail> {
  const refs: string[] = [];
  for (const [i, url] of urls.entries()) {
    const res = await createShopImage(ctx.conn, url, `Sites Bild ${i + 1}`);
    if (!res.ok) return res;
    refs.push(res.ref);
  }
  return { ok: true, refs };
}

export type ThemeInstructionResult =
  | {
      ok: true;
      /** Neuer Inhalt der geänderten Dateien (leer = KI hat nichts geändert). */
      changed: ShopifyFileMap;
      summary: string;
      /** Frische Vorschau nach der Änderung (null, falls nicht abrufbar). */
      html: string | null;
      previewError?: string;
    }
  | Fail;

/**
 * Kompletter Ablauf für eine KI-Anweisung bei Shopify-Projekten:
 * KI ändert die Theme-Dateien → Original sichern → in Shopify speichern →
 * neue Vorschau holen.
 */
export async function applyThemeInstruction(
  ctx: ShopifyProjectContext,
  input: { pageHtml: string; instruction: string; model?: string; effort?: Effort },
): Promise<ThemeInstructionResult> {
  const ai = await editShopifyThemeWithAI({
    conn: ctx.conn,
    themeId: ctx.themeId,
    templateFile: ctx.template,
    pageHtml: input.pageHtml,
    instruction: input.instruction,
    model: input.model,
    effort: input.effort,
  });
  if (!ai.ok) return ai;
  if (Object.keys(ai.changed).length === 0) {
    return { ok: true, changed: {}, summary: ai.summary, html: null };
  }

  await rememberBaseline(ctx, ai.originals);
  const written = await upsertThemeFiles(ctx.conn, ctx.themeId, ai.changed);
  if (!written.ok) return written;

  const preview = await fetchProjectPreview(ctx);
  return {
    ok: true,
    changed: ai.changed,
    summary: ai.summary,
    html: preview.ok ? preview.html : null,
    previewError: preview.ok ? undefined : preview.error,
  };
}

/**
 * Inhalt der angegebenen Dateien für einen bestimmten Stand: Inhalt aus dem
 * Stand, sonst das gemerkte Original.
 */
export function resolveState(
  keys: Iterable<string>,
  state: ShopifyFileMap,
  baseline: ShopifyFileMap,
): ShopifyFileMap {
  const out: ShopifyFileMap = {};
  for (const k of keys) {
    const v = state[k] ?? baseline[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Theme-Dateien auf einen gespeicherten Stand zurücksetzen. */
export async function writeThemeState(
  ctx: ShopifyProjectContext,
  files: ShopifyFileMap,
): Promise<{ ok: true } | Fail> {
  const res = await upsertThemeFiles(ctx.conn, ctx.themeId, files);
  return res.ok ? { ok: true } : res;
}
