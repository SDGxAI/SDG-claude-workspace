import "server-only";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const RED = "#e30613";

/**
 * Gebrandete Mitteilungs-E-Mail im SDG-Look (angelehnt an die SDG/BIG-Service-
 * Mails): SDG-Logo oben, Anrede mit Namen, Nachricht, roter Button in die App,
 * Grußformel „Dein Group AI Team", Firmen-Footer. Tabellen-Layout + Inline-
 * Styles für maximale Kompatibilität in Mail-Clients.
 */
export function buildAnnouncementEmail(input: {
  message: string;
  recipientName?: string | null;
  projectTitle?: string | null;
  projectUrl?: string | null;
  siteUrl?: string | null;
}): { html: string; text: string } {
  const { message, recipientName, projectTitle, projectUrl, siteUrl } = input;

  const greetingName = recipientName?.trim();
  const greeting = greetingName ? `Guten Tag ${escapeHtml(greetingName)},` : "Guten Tag,";
  const heading = projectTitle ? escapeHtml(projectTitle) : "Neue Mitteilung";
  const messageHtml = escapeHtml(message).replace(/\n/g, "<br>");
  const linkUrl = projectUrl || siteUrl || "";

  const logo = siteUrl
    ? `<img src="${siteUrl}/sdg-logo-box.png" alt="SDG" height="30" style="height:30px;display:block" />`
    : `<span style="display:inline-block;background:${RED};color:#fff;font-weight:800;letter-spacing:3px;padding:5px 10px;border-radius:3px">S·D·G</span>`;

  const button = linkUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px">
         <tr><td style="border-radius:8px;background:${RED}">
           <a href="${linkUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px">In der App ansehen →</a>
         </td></tr>
       </table>`
    : "";

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <tr><td style="padding:20px 28px 18px;border-bottom:1px solid #eeeeee">${logo}</td></tr>
        <tr><td style="padding:28px 28px 8px">
          <div style="font-size:24px;font-weight:700;color:#111827;line-height:1.25">${heading}</div>
        </td></tr>
        <tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.6;color:#374151">
          <p style="margin:0 0 14px">${greeting}</p>
          <div style="margin:0 0 4px">${messageHtml}</div>
          ${button}
          <p style="margin:22px 0 2px">Viele Grüße</p>
          <p style="margin:0;font-weight:600">Dein Group AI Team</p>
        </td></tr>
        <tr><td style="padding:22px 28px 26px">
          <div style="border-top:1px solid #eeeeee;padding-top:16px;font-size:12px;line-height:1.6;color:#9ca3af">
            <strong style="color:#6b7280">SIMBA-DICKIE-GROUP GmbH</strong><br>
            Werkstraße 1, 90765 Fürth<br>
            Telefon: +49 (0)9552 9301 0<br>
            Geschäftsführer: Florian Sieber, Manfred Duschl, Uwe Weiler<br>
            Ust-Id-Nummer: DE 266 171 184 · Amtsgericht: Fürth, HR B 11688
            <p style="margin:12px 0 0">
              Bitte beachte: Dies ist eine automatisch erstellte Nachricht. Eine direkte Antwort auf diese
              E-Mail ist nicht möglich. Die weitere Kommunikation findet in der App statt.
            </p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text =
    `${greetingName ? `Guten Tag ${greetingName},` : "Guten Tag,"}\n\n` +
    `${message}\n` +
    `${linkUrl ? `\nIn der App ansehen: ${linkUrl}\n` : ""}` +
    `\nViele Grüße\nDein Group AI Team\n\n` +
    `—\nSIMBA-DICKIE-GROUP GmbH, Werkstraße 1, 90765 Fürth\n` +
    `Dies ist eine automatisch erstellte Nachricht.`;

  return { html, text };
}
