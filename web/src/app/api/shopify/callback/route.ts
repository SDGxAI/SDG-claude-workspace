import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadConnection } from "@/lib/shopify/client";
import { fetchShopName } from "@/lib/shopify/themes";
import {
  decodeOAuthCookie,
  exchangeOAuthCode,
  OAUTH_COOKIE,
  siteUrl,
  verifyShopifyHmac,
} from "@/lib/shopify/oauth";

export const dynamic = "force-dynamic";

function back(params: Record<string, string>) {
  const url = new URL(`${siteUrl()}/admin/shopify`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}

/**
 * Rückkehr von der Shopify-Freigabe: Signatur + Zufallswert prüfen, Code
 * gegen ein dauerhaftes Zugriffstoken tauschen und bei der Verbindung
 * speichern. Nur für angemeldete Admins.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const shop = params.get("shop");
  const state = params.get("state");

  // Nur Admins dürfen Shops verbinden.
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
  if (!profile?.is_admin) return back({ error: "Nur Admins dürfen Shops verbinden." });

  const pending = decodeOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);
  if (!code || !shop || !state || !pending || pending.state !== state) {
    return back({
      error: "Die Freigabe ist abgelaufen oder ungültig. Bitte in Sites erneut auf „Über Shopify freigeben“ klicken.",
    });
  }

  const conn = await loadConnection(pending.connectionId);
  if (!conn || conn.shop_domain !== shop.toLowerCase()) {
    return back({ error: "Die Freigabe gehört zu einem anderen Shop. Bitte erneut starten." });
  }
  if (!conn.client_secret || !verifyShopifyHmac(params, conn.client_secret.trim())) {
    return back({ error: "Die Antwort von Shopify konnte nicht bestätigt werden (Signatur). Stimmt das Client-Secret?" });
  }

  const exchanged = await exchangeOAuthCode(conn, code);
  if (!exchanged.ok) return back({ error: exchanged.error });

  await createAdminClient()
    .from("shopify_connections")
    .update({ access_token: exchanged.token, cached_token: null, cached_token_expires_at: null })
    .eq("id", conn.id);

  const test = await fetchShopName({ ...conn, access_token: exchanged.token });
  if (!test.ok) return back({ error: test.error });
  return back({ connected: test.name });
}
