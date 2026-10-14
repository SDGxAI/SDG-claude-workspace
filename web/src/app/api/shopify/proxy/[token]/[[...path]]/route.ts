import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadConnection } from "@/lib/shopify/client";
import { themeNumericId } from "@/lib/shopify/paths";
import { isBlockedPath, storefrontCookie, verifyProxyToken } from "@/lib/shopify/proxy";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "600",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SDG-Sites";

function plain(status: number, text: string) {
  return new Response(text, {
    status,
    headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

type Ctx = { params: Promise<{ token: string; path?: string[] }> | { token: string; path?: string[] } };

/**
 * Leitet Live-Anfragen der Shopify-Vorschau (Preise, Produktlisten,
 * Section-Rendering …) mit Shop-Passwort und Vorschau-Theme an Shopify weiter.
 */
async function handle(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { token, path = [] } = await ctx.params;
  const projectId = verifyProxyToken(token);
  if (!projectId) return plain(403, "Vorschau-Zugang abgelaufen. Bitte Seite neu laden.");

  const pathname = `/${path.map((p) => encodeURIComponent(decodeURIComponent(p))).join("/")}`;
  if (isBlockedPath(pathname)) return plain(403, "Nicht erlaubt.");

  const { data: project } = await createAdminClient()
    .from("projects")
    .select("source, shopify_connection_id, shopify_theme_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.source !== "shopify" || !project.shopify_connection_id || !project.shopify_theme_id) {
    return plain(404, "Projekt nicht gefunden.");
  }
  const conn = await loadConnection(project.shopify_connection_id);
  if (!conn) return plain(404, "Shop nicht verbunden.");

  const target = new URL(`https://${conn.shop_domain}${pathname}`);
  request.nextUrl.searchParams.forEach((v, k) => target.searchParams.append(k, v));
  target.searchParams.set("preview_theme_id", themeNumericId(project.shopify_theme_id));

  const method = request.method === "HEAD" ? "HEAD" : request.method;
  const body = method === "POST" ? await request.arrayBuffer() : undefined;

  const send = async (cookie: string) =>
    fetch(target, {
      method,
      body,
      redirect: "manual",
      cache: "no-store",
      headers: {
        "user-agent": UA,
        accept: request.headers.get("accept") ?? "*/*",
        "accept-language": "de-DE,de;q=0.9",
        ...(request.headers.get("content-type")
          ? { "content-type": request.headers.get("content-type")! }
          : {}),
        ...(request.headers.get("x-requested-with")
          ? { "x-requested-with": request.headers.get("x-requested-with")! }
          : {}),
        ...(cookie ? { cookie } : {}),
      },
    });

  let res: Response;
  try {
    res = await send(await storefrontCookie(conn));
    // Passwort-Sitzung abgelaufen → einmal neu anmelden und wiederholen.
    if (res.status >= 300 && res.status < 400 && /\/password/.test(res.headers.get("location") ?? "")) {
      res = await send(await storefrontCookie(conn, true));
    }
  } catch {
    return plain(502, "Shop nicht erreichbar.");
  }

  // Weiterleitungen innerhalb des Shops über die Durchleitung umbiegen.
  const headers: Record<string, string> = { ...CORS, "cache-control": "no-store" };
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const loc = new URL(location, target);
    if (loc.host === conn.shop_domain && !loc.pathname.startsWith("/password")) {
      const base = request.nextUrl.pathname.split("/").slice(0, 5).join("/");
      headers.location = `${base}${loc.pathname}${loc.search}`;
      return new Response(null, { status: res.status, headers });
    }
    return plain(204, "");
  }

  const contentType = res.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  // Theme-Dateien (Skripte/Module) dürfen kurz zwischengespeichert werden.
  if (pathname.startsWith("/cdn/") && res.ok) headers["cache-control"] = "public, max-age=600";
  return new Response(method === "HEAD" ? null : res.body, { status: res.status, headers });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx);
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx);
}
export async function HEAD(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx);
}
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
