"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ContentState } from "@/types/database";

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Speichert den aktuellen Bearbeitungsstand (content_state) einer Seite.
 * RLS erlaubt das Update nur für Editoren/Admins des Projekts.
 */
export async function savePageContent(
  pageId: string,
  projectId: string,
  contentState: ContentState,
): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  const { error } = await supabase
    .from("pages")
    .update({ content_state: contentState })
    .eq("id", pageId);

  if (error) {
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export interface SnapshotEntry {
  id: string;
  label: string;
  created_at: string;
  content_state: ContentState;
}

export type SnapshotResult =
  | { ok: true; snapshots: SnapshotEntry[] }
  | { ok: false; error: string };

/** Liste der Snapshots einer Seite (neueste zuerst). */
export async function getSnapshots(pageId: string): Promise<SnapshotEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("snapshots")
    .select("id, label, created_at, content_state")
    .eq("page_id", pageId)
    .order("created_at", { ascending: false });
  return (data ?? []) as SnapshotEntry[];
}

/** Speichert den aktuellen Stand als benannten, dauerhaften Snapshot. */
export async function createSnapshot(
  pageId: string,
  label: string,
  contentState: ContentState,
): Promise<SnapshotResult> {
  const trimmed = label.trim();
  if (!trimmed) {
    return { ok: false, error: "Bitte einen Namen für den Snapshot eingeben." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  const { error } = await supabase.from("snapshots").insert({
    page_id: pageId,
    label: trimmed.slice(0, 120),
    content_state: contentState,
    created_by: user.id,
  });
  if (error) {
    return { ok: false, error: "Snapshot konnte nicht gespeichert werden." };
  }

  return { ok: true, snapshots: await getSnapshots(pageId) };
}

/**
 * Stellt einen Snapshot wieder her: übernimmt dessen content_state als
 * aktuellen Stand der Seite und gibt ihn zurück (für den Editor).
 */
export async function restoreSnapshot(
  snapshotId: string,
  pageId: string,
  projectId: string,
): Promise<{ ok: true; contentState: ContentState } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: snapshot } = await supabase
    .from("snapshots")
    .select("content_state")
    .eq("id", snapshotId)
    .single();
  if (!snapshot) {
    return { ok: false, error: "Snapshot nicht gefunden." };
  }

  const contentState = snapshot.content_state as ContentState;
  const { error } = await supabase
    .from("pages")
    .update({ content_state: contentState })
    .eq("id", pageId);
  if (error) {
    return { ok: false, error: "Wiederherstellen fehlgeschlagen." };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, contentState };
}
