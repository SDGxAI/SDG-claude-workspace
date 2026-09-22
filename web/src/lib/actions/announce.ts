"use server";

import { getProjectAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/actions/notifications";
import { sendAnnouncementEmails } from "@/lib/email";

export interface Recipient {
  id: string;
  email: string;
}

/** Beteiligte eines Projekts (für die Empfänger-Auswahl) – nur Admins. */
export async function getAnnounceRecipients(
  projectId: string,
): Promise<Recipient[]> {
  const access = await getProjectAccess(projectId);
  if (!access?.isAdmin) return [];

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  const ids = (members ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", ids);
  return (profiles ?? []).map((p) => ({ id: p.id, email: p.email }));
}

export type AnnounceResult =
  | { ok: true; sent: number; emailNote?: string }
  | { ok: false; error: string };

/**
 * Sendet eine Mitteilung (Glocke) an ausgewählte Empfänger – nur Admins.
 * Optional zusätzlich per E-Mail.
 */
export async function sendAnnouncement(
  projectId: string,
  body: string,
  recipientIds: string[],
  alsoEmail: boolean,
): Promise<AnnounceResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Bitte eine Nachricht eingeben." };
  if (recipientIds.length === 0)
    return { ok: false, error: "Bitte mindestens eine Person auswählen." };

  const access = await getProjectAccess(projectId);
  if (!access?.isAdmin) {
    return { ok: false, error: "Nur Admins dürfen Mitteilungen senden." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: project } = await supabase
    .from("projects")
    .select("title")
    .eq("id", projectId)
    .maybeSingle();

  // Nur echte Projektmitglieder als Empfänger zulassen.
  const { data: members } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const targetIds = recipientIds.filter((id) => memberIds.has(id));
  if (targetIds.length === 0)
    return { ok: false, error: "Keine gültigen Empfänger ausgewählt." };

  const titlePart = project?.title ? ` (Projekt „${project.title}“)` : "";

  // Glocke: je Empfänger eine Mitteilung.
  for (const userId of targetIds) {
    await createNotification(admin, {
      userId,
      type: "announcement",
      body: `📣 ${text}${titlePart}`,
      projectId,
    });
  }

  // Optional E-Mail.
  let emailNote: string | undefined;
  if (alsoEmail) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", targetIds);
    const emails = (profiles ?? []).map((p) => p.email).filter(Boolean);
    const subject = project?.title
      ? `Mitteilung zu „${project.title}"`
      : "Mitteilung – SDG Landingpage-Editor";
    const res = await sendAnnouncementEmails(emails, subject, text);
    if (res.ok) emailNote = "auch per E-Mail versendet";
    else if (res.skipped)
      emailNote =
        "E-Mail-Versand ist noch nicht eingerichtet – die Mitteilung ging nur an die Glocke";
    else emailNote = `E-Mail fehlgeschlagen: ${res.error}`;
  }

  return { ok: true, sent: targetIds.length, emailNote };
}
