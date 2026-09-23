import "server-only";
import nodemailer from "nodemailer";

export type SendResult = { ok: true } | { ok: false; error: string };

/** Umgebungswert lesen und versehentliche Leerzeichen/Umbrüche entfernen. */
function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Ist überhaupt ein Versandweg (SMTP oder Resend) konfiguriert? */
export function emailConfigured(): boolean {
  if (!env("NOTIFY_EMAIL_FROM")) return false;
  const smtp = env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS");
  return Boolean(smtp || env("RESEND_API_KEY"));
}

/**
 * Versendet EINE E-Mail (HTML + Text-Fallback) an einen Empfänger.
 * Weg 1: SMTP (Agentur-Postfach). Weg 2: Resend (API). Absender = NOTIFY_EMAIL_FROM.
 */
export async function sendMail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<SendResult> {
  const from = env("NOTIFY_EMAIL_FROM");
  if (!from) return { ok: false, error: "E-Mail-Absender nicht konfiguriert." };

  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");

  if (host && user && pass) {
    const port = Number(env("SMTP_PORT") || 587);
    try {
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // 465 = SSL, sonst STARTTLS
        auth: { user, pass },
      });
      await transport.sendMail({ from, to, subject, html, text });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? `SMTP: ${e.message}` : "SMTP-Fehler.",
      };
    }
  }

  const resendKey = env("RESEND_API_KEY");
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      if (!res.ok) return { ok: false, error: `Resend-Fehler (${res.status}).` };
      return { ok: true };
    } catch {
      return { ok: false, error: "E-Mail konnte nicht gesendet werden." };
    }
  }

  return { ok: false, error: "Kein E-Mail-Versandweg konfiguriert." };
}
