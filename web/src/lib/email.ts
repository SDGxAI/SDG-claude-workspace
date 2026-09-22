import "server-only";

export type EmailSendResult =
  | { ok: true }
  | { ok: false; skipped: true } // E-Mail nicht eingerichtet
  | { ok: false; skipped?: false; error: string };

/**
 * Verschickt eine Mitteilung per E-Mail an mehrere Empfänger (als BCC, damit
 * sich die Empfänger nicht gegenseitig sehen). Nutzt Resend, wenn
 * RESEND_API_KEY und NOTIFY_EMAIL_FROM gesetzt sind – sonst wird sauber
 * übersprungen (die App funktioniert ohne E-Mail weiter).
 */
export async function sendAnnouncementEmails(
  recipients: string[],
  subject: string,
  text: string,
): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM;
  if (!key || !from) return { ok: false, skipped: true };
  if (recipients.length === 0) return { ok: true };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [from],
        bcc: recipients,
        subject,
        text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `E-Mail-Dienst-Fehler (${res.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "E-Mail konnte nicht gesendet werden." };
  }
}
