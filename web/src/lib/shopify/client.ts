import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

/** Version der Shopify Admin-API, gegen die Sites arbeitet. */
export const SHOPIFY_API_VERSION = "2026-07";

export type ShopifyConnection =
  Database["public"]["Tables"]["shopify_connections"]["Row"];

export type Ok<T> = { ok: true } & T;
export type Fail = { ok: false; error: string };

/** Verbindung samt Zugangsdaten laden (nur serverseitig, Admin-Client). */
export async function loadConnection(id: string): Promise<ShopifyConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("shopify_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/**
 * Liefert ein gültiges Admin-API-Token. Zwei Varianten:
 * - fest hinterlegtes Token (ältere, im Shopify-Admin angelegte App)
 * - Client-ID + Secret einer Dev-Dashboard-App („client credentials“):
 *   Token gilt 24 h, wird zwischengespeichert und bei Bedarf erneuert.
 */
async function getAccessToken(
  conn: ShopifyConnection,
  forceRefresh = false,
): Promise<Ok<{ token: string }> | Fail> {
  if (conn.access_token?.trim()) {
    return { ok: true, token: conn.access_token.trim() };
  }
  if (!conn.client_id?.trim() || !conn.client_secret?.trim()) {
    return { ok: false, error: "Für diesen Shop sind keine Zugangsdaten hinterlegt." };
  }

  const expires = conn.cached_token_expires_at
    ? new Date(conn.cached_token_expires_at).getTime()
    : 0;
  if (!forceRefresh && conn.cached_token && expires - Date.now() > 5 * 60 * 1000) {
    return { ok: true, token: conn.cached_token };
  }

  let res: Response;
  try {
    res = await fetch(`https://${conn.shop_domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: conn.client_id.trim(),
        client_secret: conn.client_secret.trim(),
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: `Shop ${conn.shop_domain} ist nicht erreichbar.` };
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error_description?: string; error?: string };
      detail = j.error_description || j.error || "";
    } catch {
      /* kein JSON */
    }
    return {
      ok: false,
      error:
        `Shopify lehnt die App-Zugangsdaten ab (${res.status}${detail ? `: ${detail}` : ""}). ` +
        "Stimmen Client-ID und Secret, und ist die App in diesem Shop installiert?",
    };
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    return { ok: false, error: "Shopify hat kein Zugriffstoken geliefert." };
  }

  const expiresAt = new Date(Date.now() + (json.expires_in ?? 86399) * 1000).toISOString();
  conn.cached_token = json.access_token;
  conn.cached_token_expires_at = expiresAt;
  if (conn.id) {
    await createAdminClient()
      .from("shopify_connections")
      .update({ cached_token: json.access_token, cached_token_expires_at: expiresAt })
      .eq("id", conn.id);
  }
  return { ok: true, token: json.access_token };
}

/**
 * GraphQL-Aufruf gegen die Admin-API eines Shops – mit verständlichen
 * deutschen Fehlermeldungen und einem Wiederholungsversuch bei Drosselung.
 */
export async function shopifyGraphql<T>(
  conn: ShopifyConnection,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Ok<{ data: T }> | Fail> {
  let tokenRes = await getAccessToken(conn);
  if (!tokenRes.ok) return tokenRes;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(
        `https://${conn.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Shopify-Access-Token": tokenRes.token,
          },
          body: JSON.stringify({ query, variables }),
          cache: "no-store",
        },
      );
    } catch {
      return { ok: false, error: `Shop ${conn.shop_domain} ist nicht erreichbar.` };
    }

    if (res.status === 401 && attempt === 0 && !conn.access_token) {
      // Zwischengespeichertes Token abgelaufen/ungültig → einmal neu holen.
      tokenRes = await getAccessToken(conn, true);
      if (!tokenRes.ok) return tokenRes;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: `Shopify ist gerade nicht verfügbar (${res.status}). Bitte gleich erneut versuchen.` };
    }
    if (res.status === 401) {
      return { ok: false, error: "Shopify lehnt den Zugriff ab (401). Bitte die Zugangsdaten des Shops prüfen." };
    }
    if (res.status === 403) {
      return {
        ok: false,
        error:
          "Shopify verweigert den Zugriff (403). Hat die App die Berechtigungen read_themes, write_themes und write_files?",
      };
    }
    if (res.status === 404) {
      return { ok: false, error: `Shop ${conn.shop_domain} wurde nicht gefunden.` };
    }
    if (!res.ok) {
      return { ok: false, error: `Shopify-Fehler (${res.status}).` };
    }

    const json = (await res.json()) as {
      data?: T;
      errors?: { message?: string; extensions?: { code?: string } }[];
    };
    if (json.errors?.length) {
      const throttled = json.errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const msg = json.errors.map((e) => e.message).filter(Boolean).join(" · ");
      const denied = json.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
      return {
        ok: false,
        error: denied
          ? `Der App fehlt eine Berechtigung in Shopify (${msg}).`
          : `Shopify meldet einen Fehler: ${msg || "unbekannt"}`,
      };
    }
    if (!json.data) return { ok: false, error: "Shopify hat keine Daten geliefert." };
    return { ok: true, data: json.data };
  }
  return { ok: false, error: "Shopify antwortet nicht. Bitte später erneut versuchen." };
}
