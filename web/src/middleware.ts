import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Hält die Supabase-Session in den Cookies aktuell (Standard-Pattern von
 * @supabase/ssr für Next.js). Ohne das würden abgelaufene Sessions nicht
 * automatisch erneuert.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Erneuert die Sitzung bei Bedarf. getClaims prüft die Anmeldung meist
  // direkt hier (ohne Rückfrage beim Anmeldedienst) – spart bei jedem Klick
  // eine Wartezeit. Die eigentliche Rechteprüfung machen die Seiten selbst.
  // Klappt das nicht, wie bisher über den Anmeldedienst.
  const ok = await supabase.auth
    .getClaims()
    .then((r) => !!r.data?.claims?.sub)
    .catch(() => false);
  if (!ok) await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/shopify/proxy|api/shopify/view|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
