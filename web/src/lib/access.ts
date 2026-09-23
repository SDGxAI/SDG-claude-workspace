import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import type { ProjectRole } from "@/types/database";

export interface ProjectAccess {
  userId: string;
  isAdmin: boolean;
  /** Effektive Rolle im Projekt: Admin zählt immer als "editor". */
  role: ProjectRole | null;
  canEdit: boolean;
  canComment: boolean;
}

/**
 * Ermittelt die effektive Rolle der eingeloggten Person für ein Projekt.
 * Gibt null zurück, wenn nicht eingeloggt oder kein Zugriff besteht.
 * Admins gelten immer als Editor mit vollem Zugriff.
 */
export async function getProjectAccess(
  projectId: string,
): Promise<ProjectAccess | null> {
  // Nutzer + Admin-Flag stammen aus dem pro Request memoisierten Profil
  // (bereits im Layout geladen) – kein zusätzlicher Roundtrip.
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const user = { id: profile.id };

  if (profile.is_admin) {
    return {
      userId: user.id,
      isAdmin: true,
      role: "editor",
      canEdit: true,
      canComment: true,
    };
  }

  const supabase = await createClient();

  // Effektive Rolle = höchste aus Marken-Rolle und (Alt-)Projekt-Mitgliedschaft.
  const { data: roleText } = await supabase.rpc("effective_project_role", {
    p_project_id: projectId,
  });
  const role = (roleText as ProjectRole | null) ?? null;

  if (!role) {
    return { userId: user.id, isAdmin: false, role: null, canEdit: false, canComment: false };
  }

  return {
    userId: user.id,
    isAdmin: false,
    role,
    canEdit: role === "editor",
    canComment: role === "editor" || role === "reviewer",
  };
}
