"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CommentStatus } from "@/types/database";

export type CommentActionResult = { ok: true } | { ok: false; error: string };

/** Neuer Kommentar (Pin) an Position x/y (Prozent) auf der Vorschau. */
export async function addComment(input: {
  pageId: string;
  projectId: string;
  body: string;
  xPct: number;
  yPct: number;
}): Promise<CommentActionResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Kommentar darf nicht leer sein." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };

  const { error } = await supabase.from("comments").insert({
    page_id: input.pageId,
    author_id: user.id,
    body,
    x_pct: clampPct(input.xPct),
    y_pct: clampPct(input.yPct),
  });
  if (error) {
    return { ok: false, error: "Kommentar konnte nicht gespeichert werden." };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true };
}

/** Antwort auf einen bestehenden Kommentar (Thread). */
export async function addReply(input: {
  pageId: string;
  projectId: string;
  parentId: string;
  body: string;
  xPct: number;
  yPct: number;
}): Promise<CommentActionResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Antwort darf nicht leer sein." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };

  const { error } = await supabase.from("comments").insert({
    page_id: input.pageId,
    parent_id: input.parentId,
    author_id: user.id,
    body,
    x_pct: clampPct(input.xPct),
    y_pct: clampPct(input.yPct),
  });
  if (error) {
    return { ok: false, error: "Antwort konnte nicht gespeichert werden." };
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true };
}

/** Setzt den Status eines Kommentars (offen/erledigt). */
export async function setCommentStatus(
  commentId: string,
  projectId: string,
  status: CommentStatus,
): Promise<CommentActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .update({ status })
    .eq("id", commentId);
  if (error) {
    return { ok: false, error: "Status konnte nicht geändert werden." };
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

function clampPct(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
