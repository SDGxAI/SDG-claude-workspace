import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ShopifyConnection } from "@/lib/shopify/client";

/**
 * Durchleitung für Live-Daten der Shopify-Vorschau: Theme-Skripte laden
 * Preise, Produktlisten usw. nach. In der abgeschotteten Vorschau gehen diese
 * Anfragen über Sites, das sie mit Shop-Passwort + Vorschau-Theme an Shopify
 * weiterreicht. Zugriff nur mit einem zeitlich begrenzten, signierten Token.
 */

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function secret(): string {
  const s = process.env.SHOPIFY_PROXY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHmac("sha256", "sites-shopify-proxy").update(s).digest("hex");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createProxyToken(projectId: string): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${projectId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Gibt die Projekt-ID zurück, wenn das Token gültig und nicht abgelaufen ist. */
export function verifyProxyToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [projectId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!projectId || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(`${projectId}.${expRaw}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return projectId;
}

/** Basis-Adresse der Durchleitung für ein Projekt (für das Vorschau-Skript). */
export function proxyBaseUrl(projectId: string): string {
  const site = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  ).replace(/\/$/, "");
  return `${site}/api/shopify/proxy/${createProxyToken(projectId)}`;
}

/** Pfade, die nie durchgeleitet werden (Konto, Kasse, Admin). */
export function isBlockedPath(path: string): boolean {
  return /^\/(admin|account|checkout|checkouts|services\/login|password|apps\/[^/]+\/admin)(\/|$)/i.test(
    path,
  );
}

// Shop-Passwort-Sitzungen kurz zwischenspeichern (pro Server-Instanz).
const sessionCache = new Map<string, { cookie: string; expires: number }>();

function cookiesFrom(res: Response): string[] {
  const list =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/);
  return list.map((c) => c.split(";")[0]).filter((c) => c.includes("="));
}

/** Cookie-Header für den passwortgeschützten Shop (leer, wenn kein Passwort). */
export async function storefrontCookie(
  conn: ShopifyConnection,
  forceRefresh = false,
): Promise<string> {
  if (!conn.storefront_password?.trim()) return "";
  const cached = sessionCache.get(conn.id);
  if (!forceRefresh && cached && cached.expires > Date.now()) return cached.cookie;
  try {
    const res = await fetch(`https://${conn.shop_domain}/password`, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        form_type: "storefront_password",
        utf8: "✓",
        password: conn.storefront_password.trim(),
      }).toString(),
    });
    const cookie = cookiesFrom(res).join("; ");
    sessionCache.set(conn.id, { cookie, expires: Date.now() + 10 * 60 * 1000 });
    return cookie;
  } catch {
    return "";
  }
}
