"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectAccess } from "@/lib/access";
import { SDG_BRANDS } from "@/lib/brands";
import { parseHtmlTemplate } from "@/lib/html/parse";
import { ingestHtmlIntoProject } from "@/lib/ingest/apply";
import { loadConnection, type ShopifyConnection } from "@/lib/shopify/client";
import { fetchShopName, listThemeFiles, listThemes } from "@/lib/shopify/themes";
import { fetchThemePreviewHtml } from "@/lib/shopify/storefront";
import { fetchProjectPreview, isFail, loadShopifyProject } from "@/lib/shopify/project";
import { normalizeShopDomain, normalizeShopPath } from "@/lib/shopify/paths";
import type { ProjectStatus } from "@/types/database";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function requireAdmin(): Promise<Result<{ userId: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return { ok: false, error: "Nur Admins dürfen Shops verwalten." };
  return { ok: true, userId: user.id };
}

const MISSING_TABLE =
  "Die Shopify-Funktion ist in der Datenbank noch nicht aktiviert. Bitte die SQL-Datei 0015_shopify.sql in Supabase ausführen.";

/** Öffentliche Sicht auf eine Verbindung (ohne Secrets). */
export interface ShopifyConnectionInfo {
  id: string;
  name: string;
  shopDomain: string;
  authType: "client" | "token";
  hasPassword: boolean;
  createdAt: string;
}

export async function listShopifyConnections(): Promise<
  Result<{ connections: ShopifyConnectionInfo[] }>
> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { data, error } = await createAdminClient()
    .from("shopify_connections")
    .select("*")
    .order("name");
  if (error) return { ok: false, error: MISSING_TABLE };
  return {
    ok: true,
    connections: (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      shopDomain: c.shop_domain,
      authType: c.access_token ? "token" : "client",
      hasPassword: !!c.storefront_password,
      createdAt: c.created_at,
    })),
  };
}

/**
 * Shop verbinden (oder Zugangsdaten aktualisieren). Prüft die Verbindung,
 * bevor gespeichert wird. Leere Felder beim Bearbeiten = unverändert lassen.
 */
export async function saveShopifyConnection(input: {
  id?: string;
  name: string;
  shopDomain: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  storefrontPassword?: string;
}): Promise<Result<{ shopName: string }>> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const domain = normalizeShopDomain(input.shopDomain);
  if (!domain) {
    return { ok: false, error: "Bitte die Shop-Adresse im Format „name.myshopify.com“ angeben." };
  }

  const admin = createAdminClient();
  let existing: ShopifyConnection | null = null;
  if (input.id) {
    existing = await loadConnection(input.id);
    if (!existing) return { ok: false, error: "Verbindung nicht gefunden." };
  }

  const clientId = input.clientId?.trim() || null;
  const clientSecret = input.clientSecret?.trim() || null;
  const accessToken = input.accessToken?.trim() || null;
  const password = input.storefrontPassword?.trim();

  const draft: ShopifyConnection = {
    id: existing?.id ?? "",
    name: input.name.trim() || domain,
    shop_domain: domain,
    client_id: clientId ?? (accessToken ? null : existing?.client_id ?? null),
    client_secret: clientSecret ?? (accessToken ? null : existing?.client_secret ?? null),
    access_token: accessToken ?? (clientId ? null : existing?.access_token ?? null),
    storefront_password: password ? password : existing?.storefront_password ?? null,
    cached_token: null,
    cached_token_expires_at: null,
    created_by: existing?.created_by ?? guard.userId,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  if (!draft.access_token && !(draft.client_id && draft.client_secret)) {
    return {
      ok: false,
      error: "Bitte entweder Client-ID + Client-Secret oder ein Admin-API-Zugriffstoken eingeben.",
    };
  }

  // Verbindung testen (kein Speichern, wenn Shopify ablehnt).
  const test = await fetchShopName(draft);
  if (!test.ok) return test;

  const row = {
    name: draft.name,
    shop_domain: draft.shop_domain,
    client_id: draft.client_id,
    client_secret: draft.client_secret,
    access_token: draft.access_token,
    storefront_password: draft.storefront_password,
    cached_token: draft.cached_token,
    cached_token_expires_at: draft.cached_token_expires_at,
  };
  const { error } = existing
    ? await admin.from("shopify_connections").update(row).eq("id", existing.id)
    : await admin.from("shopify_connections").insert({ ...row, created_by: guard.userId });
  if (error) return { ok: false, error: MISSING_TABLE };

  revalidatePath("/admin/shopify");
  return { ok: true, shopName: test.name };
}

export async function deleteShopifyConnection(id: string): Promise<Result> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { error } = await createAdminClient().from("shopify_connections").delete().eq("id", id);
  if (error) return { ok: false, error: "Verbindung konnte nicht gelöscht werden." };
  revalidatePath("/admin/shopify");
  return { ok: true };
}

/** Verbindung testen: Shopname + Anzahl Themes + Abruf der Startseite. */
export async function testShopifyConnection(
  id: string,
): Promise<Result<{ message: string }>> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const conn = await loadConnection(id);
  if (!conn) return { ok: false, error: "Verbindung nicht gefunden." };
  const shop = await fetchShopName(conn);
  if (!shop.ok) return shop;
  const themes = await listThemes(conn);
  if (!themes.ok) return themes;
  const preview = themes.themes[0]
    ? await fetchThemePreviewHtml(conn, themes.themes[0].id, "/")
    : null;
  const previewMsg = !preview
    ? ""
    : preview.ok
      ? " Vorschau-Abruf klappt."
      : ` Achtung, Vorschau-Abruf: ${preview.error}`;
  return {
    ok: true,
    message: `Verbunden mit „${shop.name}“ – ${themes.themes.length} Theme(s) gefunden.${previewMsg}`,
  };
}

export async function listShopifyThemesFor(
  connectionId: string,
): Promise<Result<{ themes: { id: string; name: string; role: string }[] }>> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const conn = await loadConnection(connectionId);
  if (!conn) return { ok: false, error: "Verbindung nicht gefunden." };
  const res = await listThemes(conn);
  if (!res.ok) return res;
  return {
    ok: true,
    themes: res.themes.map((t) => ({ id: t.id, name: t.name, role: t.role })),
  };
}

export async function listShopifyTemplatesFor(
  connectionId: string,
  themeId: string,
): Promise<Result<{ templates: string[] }>> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const conn = await loadConnection(connectionId);
  if (!conn) return { ok: false, error: "Verbindung nicht gefunden." };
  const res = await listThemeFiles(conn, themeId, ["templates/*.json"]);
  if (!res.ok) return res;
  return {
    ok: true,
    templates: res.files.map((f) => f.filename).sort((a, b) => a.localeCompare(b)),
  };
}

/** Neues Projekt aus einem Shopify-Theme anlegen (nur Admins). */
export async function createShopifyProject(input: {
  title: string;
  brand: string;
  connectionId: string;
  themeId: string;
  themeName: string;
  path: string;
  template: string;
}): Promise<Result<{ projectId: string }>> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Bitte einen Projekttitel eingeben." };
  if (!SDG_BRANDS.includes(input.brand as (typeof SDG_BRANDS)[number])) {
    return { ok: false, error: "Bitte eine gültige Marke auswählen." };
  }
  if (!input.themeId) return { ok: false, error: "Bitte ein Theme auswählen." };
  if (!/^templates\/[\w.-]+\.json$/.test(input.template)) {
    return { ok: false, error: "Bitte eine Vorlage auswählen." };
  }

  const conn = await loadConnection(input.connectionId);
  if (!conn) return { ok: false, error: "Verbindung nicht gefunden." };
  const path = normalizeShopPath(input.path);

  const preview = await fetchThemePreviewHtml(conn, input.themeId, path);
  if (!preview.ok) return preview;

  let parsed;
  try {
    parsed = parseHtmlTemplate(preview.html);
  } catch {
    return { ok: false, error: "Die Shop-Seite konnte nicht analysiert werden." };
  }

  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      title,
      brand: input.brand,
      status: "entwurf" as ProjectStatus,
      created_by: guard.userId,
      source: "shopify",
      shopify_connection_id: conn.id,
      shopify_theme_id: input.themeId,
      shopify_theme_name: input.themeName.slice(0, 200),
      shopify_path: path,
      shopify_template: input.template,
    })
    .select("id")
    .single();
  if (projectError || !project) {
    return {
      ok: false,
      error: /column|source|shopify/i.test(projectError?.message ?? "")
        ? MISSING_TABLE
        : `Das Projekt konnte nicht gespeichert werden${projectError?.message ? ` (${projectError.message})` : ""}.`,
    };
  }

  const { error: pageError } = await supabase.from("pages").insert({
    project_id: project.id,
    template_html: parsed.templateHtml,
    detected_elements: parsed.detectedElements,
    content_state: parsed.contentState,
    original_filename: "shopify-vorschau.html",
  });
  if (pageError) {
    await supabase.from("projects").delete().eq("id", project.id);
    return { ok: false, error: "Die Seite konnte nicht gespeichert werden." };
  }

  revalidatePath("/projects");
  return { ok: true, projectId: project.id };
}

/**
 * Vorschau neu aus Shopify holen (z. B. wenn jemand direkt im Shopify-
 * Theme-Editor etwas geändert hat). Der bisherige Stand wird als Version
 * gesichert.
 */
export async function reloadFromShopify(projectId: string): Promise<Result> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung." };

  const shop = await loadShopifyProject(projectId);
  if (isFail(shop)) return shop;
  if (!shop) return { ok: false, error: "Dieses Projekt ist nicht mit Shopify verbunden." };

  const supabase = await createClient();
  const { data: page } = await supabase
    .from("pages")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!page) return { ok: false, error: "Seite nicht gefunden." };

  const preview = await fetchProjectPreview(shop);
  if (!preview.ok) return preview;

  const res = await ingestHtmlIntoProject(supabase, {
    pageId: page.id,
    projectId,
    html: preview.html,
    filename: "shopify-vorschau.html",
    source: "shopify",
    label: "Aus Shopify neu geladen",
  });
  if (!res.ok) return res;
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
