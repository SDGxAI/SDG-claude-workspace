import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, sendMail } from "@/lib/email";
import { buildBrandedEmail } from "@/lib/emailTemplate";

/** Erinnerung per Mail frühestens nach dieser Zeit, wenn noch ungelesen. */
const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
const TYPE = "comment_new";

/**
 * Bündel-Logik: Zähler und ob jetzt eine Mail rausgeht – abhängig davon, ob es
 * schon einen ungelesenen Hinweis gibt und wann dazu zuletzt gemailt wurde.
 */
export function nextAlertState(
  existing: { body: string; createdAt: string } | null,
  now: number,
): { count: number; sendNow: boolean } {
  if (!existing) return { count: 1, sendNow: true };
  const prev = Number(/^(\d+) neue/.exec(existing.body)?.[1] ?? "1");
  const count = (Number.isFinite(prev) ? prev : 1) + 1;
  const sendNow = now - new Date(existing.createdAt).getTime() > REMIND_AFTER_MS;
  return { count, sendNow };
}

function excerptOf(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Admins über neue Kommentare informieren – gebündelt:
 * - Erster neuer Kommentar in einem Projekt → Glocke + E-Mail.
 * - Weitere Kommentare, solange der Admin seine Mitteilungen noch nicht
 *   gelesen hat → nur der Glocken-Eintrag zählt hoch, KEINE weitere Mail
 *   (höchstens eine Erinnerung alle 24 Stunden).
 * - Nach dem Lesen löst der nächste Kommentar wieder eine Mail aus.
 * Fehler werden verschluckt: Benachrichtigungen dürfen das Kommentieren nie
 * scheitern lassen.
 */
export async function notifyAdminsOfComment(input: {
  projectId: string;
  authorId: string;
  commentId: string | null;
  body: string;
  isReply: boolean;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: admins }, { data: project }, { data: author }] = await Promise.all([
      admin.from("profiles").select("id, email, name").eq("is_admin", true),
      admin.from("projects").select("title").eq("id", input.projectId).maybeSingle(),
      admin.from("profiles").select("email, name").eq("id", input.authorId).maybeSingle(),
    ]);
    const recipients = (admins ?? []).filter((a) => a.id !== input.authorId);
    if (recipients.length === 0) return;

    const title = project?.title ?? "Projekt";
    const authorName = author?.name?.trim() || author?.email || "Jemand";
    const excerpt = excerptOf(input.body);
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "") || null;
    const projectUrl = siteUrl ? `${siteUrl}/projects/${input.projectId}` : null;
    const canMail = emailConfigured();
    const now = Date.now();

    await Promise.all(
      recipients.map(async (rcpt) => {
        // Gibt es schon einen ungelesenen Hinweis zu diesem Projekt?
        const { data: existing } = await admin
          .from("notifications")
          .select("id, body, created_at")
          .eq("user_id", rcpt.id)
          .eq("project_id", input.projectId)
          .eq("type", TYPE)
          .eq("read", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // created_at = Zeitpunkt der letzten Mail zu diesem Hinweis.
        const { count, sendNow } = nextAlertState(
          existing ? { body: existing.body, createdAt: existing.created_at } : null,
          now,
        );
        if (existing) {
          await admin
            .from("notifications")
            .update({
              body: `${count} neue Kommentare im Projekt „${title}“ – zuletzt von ${authorName}: „${excerpt}“`,
              comment_id: input.commentId,
              ...(sendNow ? { created_at: new Date(now).toISOString() } : {}),
            })
            .eq("id", existing.id);
        } else {
          await admin.from("notifications").insert({
            user_id: rcpt.id,
            type: TYPE,
            body: `Neuer ${input.isReply ? "Antwort-Kommentar" : "Kommentar"} im Projekt „${title}“ von ${authorName}: „${excerpt}“`,
            project_id: input.projectId,
            comment_id: input.commentId,
          });
        }

        if (!sendNow || !canMail || !rcpt.email) return;
        const { html, text } = buildBrandedEmail({
          subjectHeading: count > 1 ? "Neue Kommentare" : "Neuer Kommentar",
          greetingName: rcpt.name,
          paragraphs: [
            `${authorName} hat im Projekt „${title}“ ${input.isReply ? "auf einen Kommentar geantwortet" : "einen Kommentar geschrieben"}:`,
            `„${excerpt}“`,
            ...(count > 1 ? [`Insgesamt gibt es dort ${count} neue Kommentare, die Du noch nicht gesehen hast.`] : []),
          ],
          button: projectUrl ? { label: "Zu den Kommentaren →", url: projectUrl } : null,
          afterButton: [
            "Weitere Kommentare in diesem Projekt melden wir Dir erst wieder per E-Mail, nachdem Du Deine Mitteilungen in SDG Sites gelesen hast.",
          ],
          siteUrl,
        });
        await sendMail(
          rcpt.email,
          count > 1 ? `Neue Kommentare – ${title} – SDG Sites` : `Neuer Kommentar – ${title} – SDG Sites`,
          html,
          text,
        );
      }),
    );
  } catch {
    /* Benachrichtigung ist Beiwerk – nie blockierend. */
  }
}
