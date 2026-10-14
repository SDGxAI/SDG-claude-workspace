/**
 * Kleine, reine Hilfsfunktionen rund um Shopify – ohne Server-Abhängigkeiten,
 * damit sie auch im Browser (Formulare) genutzt werden können.
 */

/**
 * Normalisiert eine Shop-Adresse auf „name.myshopify.com“. Akzeptiert z. B.
 * „mein-shop“, „https://mein-shop.myshopify.com/admin“ oder
 * „admin.shopify.com/store/mein-shop“. Gibt null zurück, wenn nichts Gültiges
 * erkennbar ist.
 */
export function normalizeShopDomain(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  if (!v) return null;
  const adminStore = /admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(v);
  if (adminStore) return `${adminStore[1]}.myshopify.com`;
  v = v.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  if (!v.includes(".")) v = `${v}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v) ? v : null;
}

/** „gid://shopify/OnlineStoreTheme/123“ → „123“. */
export function themeNumericId(themeId: string): string {
  const m = /(\d+)\s*$/.exec(themeId);
  return m ? m[1] : themeId;
}

/** „gid://…/123“ oder „123“ → vollständige GID für die Admin-API. */
export function themeGid(themeId: string): string {
  return themeId.startsWith("gid://")
    ? themeId
    : `gid://shopify/OnlineStoreTheme/${themeNumericId(themeId)}`;
}

/** Seitenpfad säubern: immer mit führendem „/“, ohne Domain/Query. */
export function normalizeShopPath(raw: string): string {
  let v = raw.trim();
  if (!v) return "/";
  v = v.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  if (!v.startsWith("/")) v = `/${v}`;
  return v;
}

/** Link zur echten Shopify-Vorschau des Themes (öffnet im Browser). */
export function shopifyPreviewUrl(
  shopDomain: string,
  themeId: string,
  path: string,
): string {
  return `https://${shopDomain}${normalizeShopPath(path)}?preview_theme_id=${themeNumericId(themeId)}`;
}

/**
 * Rät die passende Vorlage (templates/*.json) zum Seitenpfad. Wird im
 * Formular als Vorauswahl genutzt und kann geändert werden.
 */
export function guessTemplateForPath(path: string, templates: string[]): string | null {
  const p = normalizeShopPath(path);
  const has = (name: string) => templates.includes(name);
  let candidate = "templates/index.json";
  if (p.startsWith("/products/")) candidate = "templates/product.json";
  else if (p === "/collections" || p === "/collections/") candidate = "templates/list-collections.json";
  else if (p.startsWith("/collections/")) candidate = "templates/collection.json";
  else if (p.startsWith("/pages/")) candidate = "templates/page.json";
  else if (/^\/blogs\/[^/]+\/[^/]+/.test(p)) candidate = "templates/article.json";
  else if (p.startsWith("/blogs/")) candidate = "templates/blog.json";
  else if (p.startsWith("/cart")) candidate = "templates/cart.json";
  else if (p.startsWith("/search")) candidate = "templates/search.json";
  if (has(candidate)) return candidate;
  return templates.find((t) => t === "templates/index.json") ?? templates[0] ?? null;
}

const ROLE_LABEL: Record<string, string> = {
  MAIN: "Live",
  UNPUBLISHED: "Nicht veröffentlicht",
  DEVELOPMENT: "Entwicklung",
  DEMO: "Demo",
  ARCHIVED: "Archiviert",
  LOCKED: "Gesperrt",
};

export function themeRoleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}
