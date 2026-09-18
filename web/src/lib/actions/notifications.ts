"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export interface NotificationItem {
  id: string;
  body: string;
  projectId: string | null;
  read: boolean;
  createdAt: string;
}

/**
 * Legt eine Mitteilung für eine Person an (serverseitig, per Admin-Client,
 * da RLS keine fremden Inserts erlaubt). Fehler werden verschluckt – eine
 * fehlende Mitteilung darf die auslösende Aktion nie scheitern lassen.
 */
export async function createNotification(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    type: string;
    body: string;
    projectId?: string | null;
    commentId?: string | null;
  },
): Promise<void> {
  try {
    await admin.from("notifications").insert({
      user_id: input.userId,
      type: input.type,
      body: input.body,
      project_id: input.projectId ?? null,
      comment_id: input.commentId ?? null,
    });
  } catch {
    /* Mitteilung ist Beiwerk – nie blockierend. */
  }
}

/** Mitteilungen der eingeloggten Person (neueste zuerst). */
export async function listNotifications(
  limit = 20,
): Promise<NotificationItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("notifications")
    .select("id, body, project_id, read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((n) => ({
    id: n.id,
    body: n.body,
    projectId: n.project_id,
    read: n.read,
    createdAt: n.created_at,
  }));
}

/** Anzahl ungelesener Mitteilungen (für das Glocken-Badge). */
export async function unreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);
  return count ?? 0;
}

/** Markiert alle eigenen Mitteilungen als gelesen. */
export async function markAllNotificationsRead(): Promise<{ ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
