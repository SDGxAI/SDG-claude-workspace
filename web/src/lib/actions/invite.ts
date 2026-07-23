"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteResult = { ok: true } | { ok: false; error: string };

/**
 * Lädt eine Person per E-Mail ein (Supabase-Einladungsmail mit Link zur
 * Passwort-festlegen-Seite). Nur für Admins erlaubt - die Prüfung läuft
 * serverseitig gegen das Profil der eingeloggten Person.
 */
export async function inviteUser(rawEmail: string): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Bitte eine gültige E-Mail-Adresse eingeben." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return { ok: false, error: "Nur Admins dürfen Personen einladen." };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/auth/confirm?next=/set-password`,
  });

  if (error) {
    if (error.code === "email_exists") {
      return { ok: false, error: "Diese E-Mail-Adresse wurde bereits eingeladen." };
    }
    return { ok: false, error: `Einladung fehlgeschlagen: ${error.message}` };
  }

  return { ok: true };
}

/**
 * Löscht eine:n Nutzer:in vollständig (Auth-Account + Profil per Cascade).
 * Nur Admins; man kann sich nicht selbst löschen.
 */
export async function deleteUser(userId: string): Promise<InviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }
  if (user.id === userId) {
    return { ok: false, error: "Du kannst dich nicht selbst löschen." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return { ok: false, error: "Nur Admins dürfen Nutzer:innen löschen." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return { ok: false, error: `Löschen fehlgeschlagen: ${error.message}` };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
