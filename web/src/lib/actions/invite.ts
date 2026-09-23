"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SDG_BRANDS } from "@/lib/brands";

export type InviteResult = { ok: true } | { ok: false; error: string };

/** Rolle für den vereinfachten Zugriff (eine Rolle für alle gewählten Marken). */
export type AccessRole = "reviewer" | "editor";

function cleanBrands(brands: string[] | undefined): string[] {
  return [
    ...new Set(
      (brands ?? []).filter((b) =>
        SDG_BRANDS.includes(b as (typeof SDG_BRANDS)[number]),
      ),
    ),
  ];
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Setzt den Zugriff einer Person: EINE Rolle für alle ausgewählten Marken.
 * Ersetzt alle bisherigen Marken-Rollen der Person.
 */
async function applyBrandAccess(
  admin: AdminClient,
  userId: string,
  role: AccessRole,
  brands: string[],
): Promise<void> {
  await admin.from("user_brand_roles").delete().eq("user_id", userId);
  const clean = cleanBrands(brands);
  if (clean.length > 0) {
    await admin
      .from("user_brand_roles")
      .insert(clean.map((brand) => ({ user_id: userId, brand, role })));
  }
}

/**
 * Lädt eine Person per E-Mail ein (Supabase-Einladungsmail mit Link zur
 * Passwort-festlegen-Seite). Nur für Admins erlaubt - die Prüfung läuft
 * serverseitig gegen das Profil der eingeloggten Person.
 */
export async function inviteUser(
  rawEmail: string,
  name?: string,
  role: AccessRole = "reviewer",
  brands: string[] = [],
): Promise<InviteResult> {
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
  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${siteUrl}/auth/confirm?next=/set-password` },
  );

  if (error) {
    if (error.code === "email_exists") {
      return { ok: false, error: "Diese E-Mail-Adresse wurde bereits eingeladen." };
    }
    return { ok: false, error: `Einladung fehlgeschlagen: ${error.message}` };
  }

  // Name + Marken-Zugriff direkt setzen (Profil existiert nach der Einladung).
  if (invited?.user) {
    const cleanName = name?.trim();
    if (cleanName) {
      await admin.from("profiles").update({ name: cleanName }).eq("id", invited.user.id);
    }
    await applyBrandAccess(admin, invited.user.id, role, brands);
  }

  revalidatePath("/admin/users");
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
  name: string,
  role: AccessRole = "reviewer",
  brands: string[] = [],
): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Bitte eine gültige E-Mail-Adresse eingeben." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Das Passwort muss mindestens 8 Zeichen lang sein." };
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

  // Profil aktiv setzen, Passwortänderung erzwingen, Name + Marken-Zugriff.
  if (created?.user) {
    await admin
      .from("profiles")
      .update({
        status: "aktiv",
        must_change_password: true,
        name: name.trim() || null,
      })
      .eq("id", created.user.id);
    await applyBrandAccess(admin, created.user.id, role, brands);
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

async function requireAdmin(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return { ok: false, error: "Nur Admins dürfen das." };
  return { ok: true };
}

/**
 * Setzt den Zugriff einer Person: eine Rolle (Reviewer/Editor) für alle
 * ausgewählten Marken. Ersetzt die bisherige Zuweisung vollständig.
 */
export async function setUserBrandAccess(
  userId: string,
  role: AccessRole,
  brands: string[],
): Promise<InviteResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (role !== "reviewer" && role !== "editor") {
    return { ok: false, error: "Ungültige Rolle." };
  }
  const admin = createAdminClient();
  await applyBrandAccess(admin, userId, role, brands);
  revalidatePath("/admin/users");
  return { ok: true };
}

/** Setzt den Anzeigenamen einer Person (für die Anrede in Mails/App). */
export async function setUserName(
  userId: string,
  name: string,
): Promise<InviteResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ name: name.trim() || null })
    .eq("id", userId);
  if (error) return { ok: false, error: "Name konnte nicht gespeichert werden." };
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
