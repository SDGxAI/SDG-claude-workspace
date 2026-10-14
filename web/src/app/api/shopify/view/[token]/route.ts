import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadConnection } from "@/lib/shopify/client";
import { fetchThemePreviewHtml, prepareLiveHtml } from "@/lib/shopify/storefront";
import { liveBridgeScript } from "@/lib/html/previewLinks";
import { createProxyToken, verifyProxyToken } from "@/lib/shopify/proxy";

export const dynamic = "force-dynamic";

// Die Seite läuft IMMER abgeschottet – auch wenn jemand den Link direkt im
// Browser öffnet: kein Zugriff auf Sites-Cookies oder die Anmeldung.
const SANDBOX_CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms";

function page(status: number, body: string) {
  return new Response(
    `<!doctype html><html lang="de"><body style="font-family:sans-serif;padding:2rem;color:#555">${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": SANDBOX_CSP,
        "cache-control": "no-store",
      },
    },
  );
}

type Ctx = { params: Promise<{ token: string }> | { token: string } };

/** Live-Ansicht eines Shopify-Projekts: echte Shop-Seite, kaum verändert. */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const projectId = verifyProxyToken(token);
  if (!projectId) return page(403, "Die Vorschau ist abgelaufen. Bitte die Seite in Sites neu laden.");

  const { data: project } = await createAdminClient()
    .from("projects")
    .select("source, shopify_connection_id, shopify_theme_id, shopify_path")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.source !== "shopify" || !project.shopify_connection_id || !project.shopify_theme_id) {
    return page(404, "Projekt nicht gefunden.");
  }
  const conn = await loadConnection(project.shopify_connection_id);
  if (!conn) return page(404, "Der Shop ist nicht mehr verbunden.");

  const res = await fetchThemePreviewHtml(conn, project.shopify_theme_id, project.shopify_path || "/", {
    raw: true,
  });
  if (!res.ok) return page(502, res.error);

  const origin = request.nextUrl.origin;
  const proxyBase = `${origin}/api/shopify/proxy/${createProxyToken(projectId)}`;
  const html = prepareLiveHtml(res.html, conn.shop_domain, liveBridgeScript(proxyBase));
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SANDBOX_CSP,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}
