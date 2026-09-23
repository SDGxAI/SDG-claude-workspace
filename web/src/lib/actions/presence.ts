"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Aktualisiert den „zuletzt gesehen"-Zeitstempel der eingeloggten Person.
 * Wird regelmäßig von der App aufgerufen, damit Admins sehen, wer online ist.
 * Admin-Client, da Nutzer:innen ihr Profil per RLS nicht selbst ändern dürfen –
 * es wird ausschließlich die eigene Zeile berührt.
 */
export async function touchPresence(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  try {
    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", user.id);
  } catch {
    /* Anwesenheit ist Beiwerk – nie blockierend. */
  }
}
