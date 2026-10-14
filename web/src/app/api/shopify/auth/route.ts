import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeShopDomain } from "@/lib/shopify/paths";
import {
  buildAuthorizeUrl,
  encodeOAuthCookie,
  newOAuthState,
  OAUTH_COOKIE,
  siteUrl,
  verifyShopifyHmac,
} from "@/lib/shopify/oauth";

export const dynamic = "force-dynamic";

/**
 * „App-URL“ der Shopify-App: Shopify öffnet sie nach der Installation bzw.
 * beim Öffnen der App. Ist der Shop in Sites angelegt und die Person Admin,
 * wird direkt die Freigabe gestartet – sonst geht es zur Shop-Verwaltung.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const domain = normalizeShopDomain(params.get("shop") ?? "");
  const toAdmin = (msg?: string) => {
    const url = new URL(`${siteUrl()}/admin/shopify`);
    if (msg) url.searchParams.set("error", msg);
    return NextResponse.redirect(url);
  };
  if (!domain) return toAdmin();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return NextResponse.redirect(`${siteUrl()}/projects`);

  const { data: conn } = await createAdminClient()
    .from("shopify_connections")
    .select("*")
    .eq("shop_domain", domain)
    .maybeSingle();
  if (!conn?.client_id || !conn.client_secret) {
    return toAdmin(
      `Der Shop ${domain} ist in Sites noch nicht angelegt. Bitte Client-ID und Secret eintragen und „Über Shopify freigeben“ klicken.`,
    );
  }
  if (params.get("hmac") && !verifyShopifyHmac(params, conn.client_secret.trim())) {
    return toAdmin("Die Anfrage von Shopify konnte nicht bestätigt werden (Signatur).");
  }

  const state = newOAuthState();
  const res = NextResponse.redirect(buildAuthorizeUrl(domain, conn.client_id.trim(), state));
  res.cookies.set(OAUTH_COOKIE, encodeOAuthCookie(state, conn.id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
  return res;
}
