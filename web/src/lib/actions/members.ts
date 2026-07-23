"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProjectRole } from "@/types/database";

export type MemberResult = { ok: true } | { ok: false; error: string };

const VALID_ROLES: ProjectRole[] = ["editor", "reviewer", "viewer"];

/**
 * Setzt die Rolle einer Person für ein Projekt oder entzieht den Zugriff
 * (role = null). Läuft über die Session der eingeloggten Person - die
 * RLS-Policies erlauben Schreibzugriff auf project_members nur für Admins.
 */
export async function setProjectRole(
  projectId: string,
  userId: string,
  role: ProjectRole | null,
): Promise<MemberResult> {
  if (role !== null && !VALID_ROLES.includes(role)) {
    return { ok: false, error: "Ungültige Rolle." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  if (role === null) {
    const { error } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId);
    if (error) {
      return { ok: false, error: "Zugriff konnte nicht entzogen werden." };
    }
  } else {
    const { error } = await supabase
      .from("project_members")
      .upsert({ project_id: projectId, user_id: userId, role });
    if (error) {
      return { ok: false, error: "Rolle konnte nicht gespeichert werden." };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
