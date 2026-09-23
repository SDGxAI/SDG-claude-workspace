"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SDG_BRANDS } from "@/lib/brands";
import { emailConfigured, sendMail } from "@/lib/email";
import { buildInviteEmail } from "@/lib/emailTemplate";

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

export type InviteUserResult =
  | { ok: true; emailed: true }
  | { ok: true; emailed: false; link: string; note: string }
  | { ok: false; error: string };

/**
 * Lädt eine Person ein: erzeugt den Einladungslink selbst und verschickt ihn
 * im SDG-Design über das eigene Postfach (SMTP). Klappt der Versand nicht,
 * bekommt der Admin den Link zum persönlichen Weitergeben. Nur Admins.
 */
export async function inviteUser(
  rawEmail: string,
  role: UserRole = "reviewer",
  brands: string[] = [],
): Promise<InviteUserResult> {
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

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const admin = createAdminClient();

  // Einladungslink erzeugen (legt den Account an, verschickt aber nichts).
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: `${siteUrl}/auth/confirm?next=/set-password` },
  });
  if (error || !link?.user) {
    if (error?.code === "email_exists") {
      return { ok: false, error: "Diese E-Mail-Adresse gibt es bereits." };
    }
    return {
      ok: false,
      error: `Einladung fehlgeschlagen${error?.message ? `: ${error.message}` : "."}`,
    };
  }

  // Rolle setzen (Profil entsteht per Trigger). Den Vornamen trägt die Person
  // beim Einrichten des Zugangs selbst ein.
  if (role === "admin") {
    await admin.from("profiles").update({ is_admin: true }).eq("id", link.user.id);
  } else {
    await applyBrandAccess(admin, link.user.id, role, brands);
  }
  revalidatePath("/admin/users");

  // Eigener Link auf die Bestätigungs-Route (Token → Session → Passwort setzen).
  const inviteUrl = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(
    link.properties.hashed_token,
  )}&type=invite&next=/set-password`;

  if (!emailConfigured()) {
    return {
      ok: true,
      emailed: false,
      link: inviteUrl,
      note: "E-Mail-Versand ist noch nicht eingerichtet.",
    };
  }

  const { html, text } = buildInviteEmail({
    recipientName: null,
    inviteUrl,
    siteUrl,
  });
  const sent = await sendMail(
    email,
    "Deine Einladung zum SDG Landingpage-Editor",
    html,
    text,
  );
  if (!sent.ok) {
    return { ok: true, emailed: false, link: inviteUrl, note: sent.error };
  }
  return { ok: true, emailed: true };
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
  role: UserRole = "reviewer",
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

  // Profil aktiv setzen, Passwortänderung erzwingen, Name + Rolle/Marken.
  if (created?.user) {
    await admin
      .from("profiles")
      .update({
        status: "aktiv",
        must_change_password: true,
        name: name.trim() || null,
        is_admin: role === "admin",
      })
      .eq("id", created.user.id);
    if (role !== "admin") {
      await applyBrandAccess(admin, created.user.id, role, brands);
    }
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

/** Rolle, wie sie im Rollen-Button gewählt wird. */
export type UserRole = AccessRole | "admin";

/**
 * Setzt die Rolle einer Person in einem Schritt: Admin (voller Zugriff) oder
 * Reviewer/Editor für die gewählten Marken. Nur Admins; die eigene Rolle
 * lässt sich nicht ändern (kein versehentliches Aussperren).
 */
export async function setUserRole(
  userId: string,
  role: UserRole,
  brands: string[],
): Promise<InviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) return { ok: false, error: "Nur Admins dürfen Rollen ändern." };
  if (userId === user.id) {
    return { ok: false, error: "Deine eigene Rolle kannst du nicht ändern." };
  }
  if (role !== "admin" && role !== "editor" && role !== "reviewer") {
    return { ok: false, error: "Ungültige Rolle." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_admin: role === "admin" })
    .eq("id", userId);
  if (error) return { ok: false, error: "Rolle konnte nicht gespeichert werden." };

  // Marken-Zugriff nur für Reviewer/Editor setzen (Admins sehen ohnehin alles).
  if (role !== "admin") {
    await applyBrandAccess(admin, userId, role, brands);
  }

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
 * Abschluss der Registrierung (nach Einladungslink bzw. erstem Login): speichert
 * den Vornamen der eingeloggten Person und hakt den Passwortwechsel ab.
 * Admin-Client, da Nutzer:innen ihr Profil per RLS nicht selbst ändern dürfen –
 * es wird ausschließlich die eigene Zeile berührt.
 */
export async function completeOnboarding(firstName: string): Promise<InviteResult> {
  const name = firstName.trim().slice(0, 60);
  if (!name) return { ok: false, error: "Bitte gib deinen Vornamen ein." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ name, must_change_password: false })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Vorname konnte nicht gespeichert werden." };
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
