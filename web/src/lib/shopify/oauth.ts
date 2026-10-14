import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Fail, Ok, ShopifyConnection } from "@/lib/shopify/client";

/**
 * Freigabe über Shopify („authorization code grant“): Sites leitet zu
 * Shopify, dort bestätigt man die Installation, Shopify leitet mit einem
 * Code zurück, den Sites gegen ein dauerhaftes Zugriffstoken tauscht.
 * Funktioniert für alle Shops, unabhängig von der Organisation.
 */

export const SHOPIFY_SCOPES = "read_themes,write_themes,write_files";
export const OAUTH_COOKIE = "sites_shopify_oauth";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function oauthCallbackUrl(): string {
  return `${siteUrl()}/api/shopify/callback`;
}

export function oauthAppUrl(): string {
  return `${siteUrl()}/api/shopify/auth`;
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex");
}

/** Cookie-Inhalt: Zufallswert + Verbindung, für die die Freigabe läuft. */
export function encodeOAuthCookie(state: string, connectionId: string): string {
  return `${state}.${connectionId}`;
}

export function decodeOAuthCookie(
  value: string | undefined,
): { state: string; connectionId: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  return { state: value.slice(0, dot), connectionId: value.slice(dot + 1) };
}

export function buildAuthorizeUrl(shopDomain: string, clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SHOPIFY_SCOPES,
    redirect_uri: oauthCallbackUrl(),
    state,
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

/** Prüft die Signatur, mit der Shopify Weiterleitungen unterschreibt. */
export function verifyShopifyHmac(params: URLSearchParams, clientSecret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmac, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Code aus der Weiterleitung gegen ein dauerhaftes Zugriffstoken tauschen. */
export async function exchangeOAuthCode(
  conn: ShopifyConnection,
  code: string,
): Promise<Ok<{ token: string; scope: string }> | Fail> {
  if (!conn.client_id || !conn.client_secret) {
    return { ok: false, error: "Client-ID oder Client-Secret fehlt." };
  }
  let res: Response;
  try {
    res = await fetch(`https://${conn.shop_domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: conn.client_id.trim(),
        client_secret: conn.client_secret.trim(),
        code,
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
      error: `Shopify hat die Freigabe nicht bestätigt (${res.status}${detail ? `: ${detail}` : ""}).`,
    };
  }
  const json = (await res.json()) as { access_token?: string; scope?: string };
  if (!json.access_token) return { ok: false, error: "Shopify hat kein Zugriffstoken geliefert." };
  return { ok: true, token: json.access_token, scope: json.scope ?? "" };
}
