"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { getProjectAccess } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Erzeugt (oder erneuert) den geheimen Update-Schlüssel eines Projekts.
 * Nur Editor:innen/Admins des Projekts. Der Schlüssel wird per Admin-Client
 * gesetzt (RLS auf projects erlaubt UPDATE sonst nur Admins).
 */
export async function regenerateIngestToken(
  projectId: string,
): Promise<TokenResult> {
  const access = await getProjectAccess(projectId);
  if (!access || !access.canEdit) {
    return { ok: false, error: "Keine Berechtigung." };
  }

  const token = `sdg_${randomBytes(24).toString("hex")}`;
  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({ ingest_token: token })
    .eq("id", projectId);
  if (error) {
    return { ok: false, error: "Schlüssel konnte nicht gespeichert werden." };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, token };
}

/** Entfernt den Update-Schlüssel wieder (Schnittstelle deaktivieren). */
export async function revokeIngestToken(
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getProjectAccess(projectId);
  if (!access || !access.canEdit) {
    return { ok: false, error: "Keine Berechtigung." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({ ingest_token: null })
    .eq("id", projectId);
  if (error) {
    return { ok: false, error: "Schlüssel konnte nicht entfernt werden." };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
