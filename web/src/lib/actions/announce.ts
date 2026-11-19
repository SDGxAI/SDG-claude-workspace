"use server";

import { getProjectAccess } from "@/lib/access";
import { askClaude } from "@/lib/ai/claude";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/actions/notifications";
import { sendMail, emailConfigured } from "@/lib/email";
import { buildAnnouncementEmail } from "@/lib/emailTemplate";

export interface Recipient {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Beteiligte eines Projekts (für die Empfänger-Auswahl) – nur Admins.
 * Das sind alle, die per Marken-Rolle oder Projekt-Mitgliedschaft Zugriff
 * auf dieses Projekt haben.
 */
export async function getAnnounceRecipients(
  projectId: string,
): Promise<Recipient[]> {
  const access = await getProjectAccess(projectId);
  if (!access?.isAdmin) return [];

  const supabase = await createClient();

  // Marke des Projekts holen.
  const { data: project } = await supabase
    .from("projects")
    .select("brand")
    .eq("id", projectId)
    .maybeSingle();

  const ids = new Set<string>();

  // Über Marken-Rolle berechtigte Personen.
  if (project?.brand) {
    const { data: byBrand } = await supabase
      .from("user_brand_roles")
      .select("user_id")
      .eq("brand", project.brand);
    (byBrand ?? []).forEach((r) => ids.add(r.user_id));
  }

  // Zusätzlich explizite Projekt-Mitglieder (Alt-Weg).
  const { data: members } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  (members ?? []).forEach((m) => ids.add(m.user_id));

  // Admins haben Zugriff auf alle Projekte → immer auswählbar.
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_admin", true);
  (admins ?? []).forEach((a) => ids.add(a.id));

  if (ids.size === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, name")
    .in("id", [...ids]);
  return (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    name: p.name ?? null,
  }));
}

export type RewriteResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Formuliert Stichpunkte per KI in eine kurze, freundliche interne
 * Benachrichtigung (Deutsch) um. Nur Admins.
 */
export async function rewriteAnnouncementText(
  projectId: string,
  input: string,
): Promise<RewriteResult> {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Bitte zuerst Stichpunkte eingeben." };

  const access = await getProjectAccess(projectId);
  if (!access?.isAdmin) return { ok: false, error: "Nur Admins." };

  const res = await askClaude({
    system:
      "Du formulierst kurze, freundliche INTERNE Benachrichtigungen für ein " +
      "Landingpage-Feedback-Tool (SIMBA-DICKIE-GROUP). Aus den Stichpunkten des " +
      "Nutzers machst du EINE knappe, klare Nachricht auf Deutsch (1–2 Sätze), " +
      "höflich, ohne Anrede und ohne Grußformel (die kommen automatisch dazu). " +
      "Kein Betreff, keine Aufzählung – nur der Fließtext. Antworte NUR mit dem Text.",
    user: raw,
    maxTokens: 400,
  });
  if (!res.ok) return res;
  const text = res.text.trim();
  if (!text) return { ok: false, error: "Die KI hat keinen Text geliefert." };
  return { ok: true, text };
}

export type AnnounceResult =
  | { ok: true; sent: number; emailNote?: string }
  | { ok: false; error: string };

/**
 * Sendet eine Mitteilung an ausgewählte Empfänger – nur Admins. Geht immer
 * per E-Mail raus und landet zusätzlich in der Glocke der App.
 */
export async function sendAnnouncement(
  projectId: string,
  body: string,
  recipientIds: string[],
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
    .select("title, brand")
    .eq("id", projectId)
    .maybeSingle();

  // Zulässige Empfänger = alle mit Zugriff (Marken-Rolle ODER Projekt-Mitglied).
  const allowed = new Set<string>();
  if (project?.brand) {
    const { data: byBrand } = await supabase
      .from("user_brand_roles")
      .select("user_id")
      .eq("brand", project.brand);
    (byBrand ?? []).forEach((r) => allowed.add(r.user_id));
  }
  const { data: members } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  (members ?? []).forEach((m) => allowed.add(m.user_id));

  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_admin", true);
  (admins ?? []).forEach((a) => allowed.add(a.id));

  const targetIds = recipientIds.filter((id) => allowed.has(id));
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

  // E-Mail (immer, personalisiert je Empfänger, gebrandet).
  if (!emailConfigured()) {
    return {
      ok: true,
      sent: targetIds.length,
      emailNote:
        "E-Mail-Versand ist noch nicht eingerichtet – die Mitteilung ging nur an die Glocke",
    };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || null;
  const projectUrl = siteUrl ? `${siteUrl}/projects/${projectId}` : null;
  const subject = project?.title
    ? `Neue Mitteilung zu „${project.title}"`
    : "Neue Mitteilung – SDG Sites";

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, name")
    .in("id", targetIds);

  let emailed = 0;
  let lastError = "";
  for (const p of profiles ?? []) {
    if (!p.email) continue;
    const { html, text: plain } = buildAnnouncementEmail({
      message: text,
      recipientName: p.name ?? null,
      projectTitle: project?.title ?? null,
      projectUrl,
      siteUrl,
    });
    const r = await sendMail(p.email, subject, html, plain);
    if (r.ok) emailed += 1;
    else lastError = r.error;
  }

  const emailNote =
    emailed > 0
      ? `per E-Mail an ${emailed} Person(en)`
      : `E-Mail fehlgeschlagen: ${lastError}`;
  return { ok: true, sent: targetIds.length, emailNote };
}
