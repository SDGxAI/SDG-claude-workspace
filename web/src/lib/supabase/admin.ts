import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Supabase-Client mit dem service_role-Key - umgeht RLS vollständig.
 *
 * NUR für serverseitige Admin-Operationen verwenden, die die normale
 * Rechteprüfung bewusst umgehen müssen (z. B. Nutzer per E-Mail einladen).
 * Der `server-only`-Import sorgt dafür, dass Next.js den Build abbricht,
 * falls diese Datei versehentlich in eine Client Component importiert wird.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
