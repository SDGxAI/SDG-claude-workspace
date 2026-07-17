import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Supabase-Client für Server Components / Server Actions / Route Handler.
 * Nutzt den anon-Key + die Nutzer-Session aus den Cookies; Zugriff wird
 * über RLS anhand der eingeloggten Person geregelt (kein Rechte-Bypass).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll wurde aus einer Server Component aufgerufen, in der
            // keine Cookies gesetzt werden dürfen. Das ist unkritisch,
            // solange Middleware die Session aktuell hält.
          }
        },
      },
    },
  );
}
