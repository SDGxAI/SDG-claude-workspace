import "server-only";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (profile?.is_admin) {
    return {
      userId: user.id,
      isAdmin: true,
      role: "editor",
      canEdit: true,
      canComment: true,
    };
  }

  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return { userId: user.id, isAdmin: false, role: null, canEdit: false, canComment: false };
  }

  return {
    userId: user.id,
    isAdmin: false,
    role: member.role,
    canEdit: member.role === "editor",
    canComment: member.role === "editor" || member.role === "reviewer",
  };
}
