import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Pro Server-Request memoisierte Zugriffe auf Nutzer und Profil.
 *
 * Ohne diese Bündelung ruft ein einziger Seitenaufruf `auth.getUser()`
 * mehrfach auf (Layout, Seite, Zugriffsprüfung) – jedes Mal ein eigener
 * Netzwerk-Roundtrip zur Auth-/DB-Instanz. React `cache()` sorgt dafür,
 * dass sich alle Aufrufe innerhalb desselben Requests einen einzigen
 * Roundtrip teilen.
 */

export interface AppProfile {
  id: string;
  email: string | null;
  is_admin: boolean;
  must_change_password: boolean;
  avatar_url: string | null;
}

/** Eingeloggte Person (validiert via Supabase Auth) – 1 Roundtrip/Request. */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Profil der eingeloggten Person – 1 Roundtrip/Request, überall wiederverwendbar. */
export const getCurrentProfile = cache(async (): Promise<AppProfile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, is_admin, must_change_password, avatar_url")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Session ohne Profilzeile (sollte nicht vorkommen) – Fallback auf Auth-Daten.
    return {
      id: user.id,
      email: user.email ?? null,
      is_admin: false,
      must_change_password: false,
      avatar_url: null,
    };
  }

  return profile as AppProfile;
});
