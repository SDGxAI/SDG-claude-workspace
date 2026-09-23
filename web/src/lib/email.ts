import "server-only";
import nodemailer from "nodemailer";

export type EmailSendResult =
  | { ok: true }
  | { ok: false; skipped: true } // E-Mail nicht eingerichtet
  | { ok: false; skipped?: false; error: string };

/**
 * Verschickt eine Mitteilung per E-Mail an mehrere Empfänger (als BCC, damit
 * sich die Empfänger nicht gegenseitig sehen).
 *
 * Zwei Wege, je nachdem was im Hosting hinterlegt ist:
 *  1. SMTP (Agentur-Postfach): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *  2. Resend (API-Dienst): RESEND_API_KEY
 * In beiden Fällen wird NOTIFY_EMAIL_FROM als Absender genutzt.
 * Ist nichts konfiguriert, wird sauber übersprungen (App läuft weiter).
 */
export async function sendAnnouncementEmails(
  recipients: string[],
  subject: string,
  text: string,
): Promise<EmailSendResult> {
  const from = process.env.NOTIFY_EMAIL_FROM;
  if (!from) return { ok: false, skipped: true };
  if (recipients.length === 0) return { ok: true };

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const resendKey = process.env.RESEND_API_KEY;

  // --- Weg 1: SMTP (Agentur-Postfach) ----------------------------------
  if (host && user && pass) {
    const port = Number(process.env.SMTP_PORT || 587);
    try {
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // 465 = SSL, sonst STARTTLS
        auth: { user, pass },
      });
      await transport.sendMail({ from, to: from, bcc: recipients, subject, text });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? `E-Mail (SMTP) fehlgeschlagen: ${e.message}`
            : "E-Mail (SMTP) fehlgeschlagen.",
      };
    }
  }

  // --- Weg 2: Resend (API) --------------------------------------------
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to: [from], bcc: recipients, subject, text }),
      });
      if (!res.ok) return { ok: false, error: `E-Mail-Dienst-Fehler (${res.status}).` };
      return { ok: true };
    } catch {
      return { ok: false, error: "E-Mail konnte nicht gesendet werden." };
    }
  }

  return { ok: false, skipped: true };
}
