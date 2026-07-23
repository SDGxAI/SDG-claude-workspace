"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SDG_BRANDS } from "@/lib/brands";

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
 * Legt eine:n Nutzer:in direkt an (mit vom Admin vergebenem Passwort) -
 * ohne Einladungsmail. Die Person wird beim ersten Login zur
 * Passwortänderung aufgefordert. Nur Admins.
 */
export async function createUserWithPassword(
  rawEmail: string,
  password: string,
  brands: string[] = [],
): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Bitte eine gültige E-Mail-Adresse eingeben." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Das Passwort muss mindestens 8 Zeichen lang sein." };
  }
  const cleanBrands = brands.filter((b) => SDG_BRANDS.includes(b as (typeof SDG_BRANDS)[number]));

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
    return { ok: false, error: "Nur Admins dürfen Nutzer:innen anlegen." };
  }

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    if (error.code === "email_exists") {
      return { ok: false, error: "Diese E-Mail-Adresse gibt es bereits." };
    }
    return { ok: false, error: `Anlegen fehlgeschlagen: ${error.message}` };
  }

  // Profil auf aktiv setzen, Passwortänderung erzwingen und Marken setzen.
  if (created?.user) {
    await admin
      .from("profiles")
      .update({
        status: "aktiv",
        must_change_password: true,
        brands: cleanBrands,
      })
      .eq("id", created.user.id);
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Macht eine Person zum Admin (oder entzieht die Admin-Rechte). Erfordert
 * das Admin-Bestätigungspasswort (Umgebungsvariable ADMIN_CONFIRM_PASSWORD)
 * und darf nur von Admins ausgeführt werden. Der eigene Status ist
 * unveränderbar (kein versehentliches Aussperren).
 */
export async function setUserAdmin(
  userId: string,
  makeAdmin: boolean,
  confirmPassword: string,
): Promise<InviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }
  if (userId === user.id) {
    return { ok: false, error: "Du kannst deinen eigenen Admin-Status nicht ändern." };
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) {
    return { ok: false, error: "Nur Admins dürfen Admin-Rechte vergeben." };
  }

  const expected = process.env.ADMIN_CONFIRM_PASSWORD;
  if (!expected) {
    return {
      ok: false,
      error:
        "Bestätigungspasswort ist nicht konfiguriert. Bitte ADMIN_CONFIRM_PASSWORD in den Umgebungsvariablen setzen.",
    };
  }
  if (confirmPassword !== expected) {
    return { ok: false, error: "Bestätigungspasswort ist falsch." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ is_admin: makeAdmin })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: "Änderung fehlgeschlagen." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

/** Setzt die Marken-Berechtigung einer Person (leer = keine Einschränkung). */
export async function setUserBrands(
  userId: string,
  brands: string[],
): Promise<InviteResult> {
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
    return { ok: false, error: "Nur Admins dürfen Firmen zuweisen." };
  }

  const cleanBrands = brands.filter((b) =>
    SDG_BRANDS.includes(b as (typeof SDG_BRANDS)[number]),
  );
  const { error } = await supabase
    .from("profiles")
    .update({ brands: cleanBrands })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: "Firmen konnten nicht gespeichert werden." };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Setzt das Flag "Passwort ändern beim nächsten Login" für die eingeloggte
 * Person zurück (nach erfolgreicher Passwortänderung).
 */
export async function clearMustChangePassword(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  // Admin-Client, da normale Nutzer:innen ihr Profil per RLS nicht selbst
  // ändern dürfen. Es wird ausschließlich das eigene Flag zurückgesetzt.
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);
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
