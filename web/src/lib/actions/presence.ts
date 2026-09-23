"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Aktualisiert den „zuletzt gesehen"-Zeitstempel der eingeloggten Person.
 * Wird regelmäßig von der App aufgerufen, damit Admins sehen, wer online ist.
 * Admin-Client, da Nutzer:innen ihr Profil per RLS nicht selbst ändern dürfen –
 * es wird ausschließlich die eigene Zeile berührt.
 */
export interface OnlineUser {
  id: string;
  label: string;
  email: string;
}

export type OnlineResult =
  | { ok: true; users: OnlineUser[] }
  | { ok: false; error: string };

/** „Online" = in den letzten 2 Minuten aktiv. */
const ONLINE_MS = 2 * 60 * 1000;

/**
 * Wer ist gerade online? Nur für Admins. Meldet vorher die aufrufende Person
 * selbst als aktiv, damit sie sofort in der Liste erscheint.
 */
export async function getOnlineUsers(): Promise<OnlineResult> {
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
  if (!me?.is_admin) return { ok: false, error: "Nur für Admins." };

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const touch = await admin
    .from("profiles")
    .update({ last_seen_at: nowIso })
    .eq("id", user.id);
  if (touch.error && /last_seen_at/.test(touch.error.message)) {
    return {
      ok: false,
      error:
        "Online-Anzeige ist noch nicht eingerichtet – bitte die SQL-Zeile für „last_seen_at“ in Supabase ausführen.",
    };
  }

  const cutoff = new Date(Date.now() - ONLINE_MS).toISOString();
  const { data, error } = await admin
    .from("profiles")
    .select("id, name, email, last_seen_at")
    .gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false });
  if (error) return { ok: false, error: "Online-Status konnte nicht geladen werden." };

  return {
    ok: true,
    users: (data ?? []).map((p) => ({
      id: p.id,
      label: p.name || p.email,
      email: p.email,
    })),
  };
}

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
