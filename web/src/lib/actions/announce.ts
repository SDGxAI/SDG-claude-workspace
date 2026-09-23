"use server";

import { getProjectAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/actions/notifications";
import { sendMail, emailConfigured } from "@/lib/email";
import { buildAnnouncementEmail } from "@/lib/emailTemplate";

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

  // Optional E-Mail (personalisiert je Empfänger, gebrandet).
  let emailNote: string | undefined;
  if (alsoEmail) {
    if (!emailConfigured()) {
      emailNote =
        "E-Mail-Versand ist noch nicht eingerichtet – die Mitteilung ging nur an die Glocke";
    } else {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || null;
      const projectUrl = siteUrl ? `${siteUrl}/projects/${projectId}` : null;
      const subject = project?.title
        ? `Neue Mitteilung zu „${project.title}"`
        : "Neue Mitteilung – SDG Landingpage-Editor";

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", targetIds);

      let sent = 0;
      let lastError = "";
      for (const p of profiles ?? []) {
        if (!p.email) continue;
        const { html, text: body } = buildAnnouncementEmail({
          message: text,
          projectTitle: project?.title ?? null,
          projectUrl,
          siteUrl,
        });
        const r = await sendMail(p.email, subject, html, body);
        if (r.ok) sent += 1;
        else lastError = r.error;
      }
      emailNote =
        sent > 0
          ? `auch per E-Mail an ${sent} Person(en)`
          : `E-Mail fehlgeschlagen: ${lastError}`;
    }
  }

  return { ok: true, sent: targetIds.length, emailNote };
}
