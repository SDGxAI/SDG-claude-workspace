import "server-only";

/*
 * E-Mail-Vorlage im Aufbau der SDG/BIG-Service-Mails:
 * graue Kopfleiste mit Logo links · große fette Überschrift · „Guten Tag
 * <Name>," · kurze Absätze mit Leerzeilen · eckiger dunkler Button mit „→"
 * (zentriert) · „Viele Grüße / Dein Group AI Team" · Footer mit Firmendaten,
 * Hinweis „automatisch erstellte Nachricht" und zentriert „Datenschutz |
 * Impressum". Tabellen-Layout + Inline-Styles für Outlook/Apple Mail/Gmail.
 */

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const TEXT = "#333333";
const DATENSCHUTZ_URL = "https://www.simba-dickie-group.de/datenschutz";
const IMPRESSUM_URL = "https://www.simba-dickie-group.de/impressum";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function para(text: string, extra = ""): string {
  return `<p style="margin:0 0 27px;font-family:${FONT};font-size:17px;line-height:27px;color:${TEXT};${extra}">${escapeHtml(
    text,
  ).replace(/\n/g, "<br>")}</p>`;
}

interface BrandedEmail {
  subjectHeading: string;
  greetingName?: string | null;
  paragraphs: string[];
  button?: { label: string; url: string } | null;
  afterButton?: string[];
  siteUrl?: string | null;
}

/** Baut eine E-Mail im SDG-Service-Mail-Aufbau (HTML + Text). */
export function buildBrandedEmail(input: BrandedEmail): { html: string; text: string } {
  const { subjectHeading, greetingName, paragraphs, button, afterButton = [], siteUrl } =
    input;
  const name = greetingName?.trim();
  const greeting = name ? `Guten Tag ${name},` : "Guten Tag,";

  const logo = siteUrl
    ? `<img src="${siteUrl}/sdg-logo-box.png" alt="SDG" width="128" height="44" style="display:block;height:44px;width:128px;border:0" />`
    : `<span style="display:inline-block;background:#e30613;color:#ffffff;font-family:${FONT};font-weight:700;font-size:20px;letter-spacing:4px;padding:8px 14px">S·D·G</span>`;

  const buttonHtml = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 27px">
         <tr><td bgcolor="#1a1a1a" style="background:#1a1a1a">
           <a href="${button.url}" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:17px;font-weight:700;line-height:22px;color:#ffffff;text-decoration:none">${escapeHtml(
             button.label,
           )}</a>
         </td></tr>
       </table>`
    : "";

  const footerLine = (t: string) =>
    `<div style="font-family:${FONT};font-size:14px;line-height:20px;color:#6b6b6b">${t}</div>`;

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
    subjectHeading,
  )}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff">
    <tr><td align="center">
      <table role="presentation" width="660" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:660px">
        <tr><td bgcolor="#ececec" style="background:#ececec;padding:18px 45px">${logo}</td></tr>
        <tr><td style="padding:40px 45px 0">
          <h1 style="margin:0 0 26px;font-family:${FONT};font-size:32px;line-height:38px;font-weight:700;color:#111111">${escapeHtml(
            subjectHeading,
          )}</h1>
          ${para(greeting)}
          ${paragraphs.map((p) => para(p)).join("\n          ")}
          ${buttonHtml}
          ${afterButton.map((p) => para(p)).join("\n          ")}
          <p style="margin:54px 0 0;font-family:${FONT};font-size:17px;line-height:27px;color:${TEXT}">Viele Grüße<br>Dein Group AI Team</p>
        </td></tr>
        <tr><td style="padding:80px 45px 40px">
          ${footerLine("SIMBA-DICKIE-GROUP GmbH<br>Werkstraße 1<br>90765 Fürth")}
          <div style="height:20px;line-height:20px">&nbsp;</div>
          ${footerLine(
            "Geschäftsführer: Florian Sieber, Manfred Duschl, Uwe Weiler<br>Ust-Id-Nummer: DE 266 171 184<br>Amtsgericht: Fürth, HR B 11688",
          )}
          <div style="height:20px;line-height:20px">&nbsp;</div>
          ${footerLine(
            "Bitte beachte: Dies ist eine automatisch erstellte Nachricht. Eine direkte Antwort auf die E-Mail ist nicht möglich. Bei Fragen wende Dich bitte an das Group AI Team.",
          )}
          <div style="height:20px;line-height:20px">&nbsp;</div>
          <div style="text-align:center;font-family:${FONT};font-size:14px;line-height:20px;color:#6b6b6b">
            <a href="${DATENSCHUTZ_URL}" style="color:#1a73e8;text-decoration:underline">Datenschutz</a> | <a href="${IMPRESSUM_URL}" style="color:#1a73e8;text-decoration:underline">Impressum</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(button ? [`${button.label.replace(/\s*→\s*$/, "")}: ${button.url}`, ""] : []),
    ...afterButton.flatMap((p) => [p, ""]),
    "",
    "Viele Grüße",
    "Dein Group AI Team",
    "",
    "—",
    "SIMBA-DICKIE-GROUP GmbH, Werkstraße 1, 90765 Fürth",
    "Dies ist eine automatisch erstellte Nachricht.",
  ].join("\n");

  return { html, text };
}

/** Mitteilung an Projektbeteiligte. */
export function buildAnnouncementEmail(input: {
  message: string;
  recipientName?: string | null;
  projectTitle?: string | null;
  projectUrl?: string | null;
  siteUrl?: string | null;
}): { html: string; text: string } {
  const { message, recipientName, projectTitle, projectUrl, siteUrl } = input;
  return buildBrandedEmail({
    subjectHeading: "Neue Mitteilung",
    greetingName: recipientName,
    paragraphs: [
      ...(projectTitle
        ? [`es gibt Neuigkeiten zur Landingpage „${projectTitle}“:`]
        : ["es gibt Neuigkeiten zu Deinen Landingpages:"]),
      message,
    ],
    button: projectUrl || siteUrl
      ? { label: "Zur Landingpage →", url: (projectUrl || siteUrl) as string }
      : null,
    afterButton: [
      "Die weitere Abstimmung findet ausschließlich über SDG Sites statt.",
    ],
    siteUrl,
  });
}

/** Einladung zu SDG Sites. */
export function buildInviteEmail(input: {
  recipientName?: string | null;
  inviteUrl: string;
  siteUrl?: string | null;
}): { html: string; text: string } {
  return buildBrandedEmail({
    subjectHeading: "Deine Einladung",
    greetingName: input.recipientName,
    paragraphs: [
      "Du wurdest zu SDG Sites eingeladen. Dort kannst Du unsere Landingpages ansehen und direkt Feedback geben.",
      "Um Deinen Zugang einzurichten, klicke bitte auf den folgenden Button und lege Dein Passwort fest.",
    ],
    button: { label: "Zugang einrichten →", url: input.inviteUrl },
    afterButton: [
      "Sobald Dein Zugang eingerichtet ist, wirst Du per E-Mail über neue Versionen und erledigte Kommentare informiert.",
    ],
    siteUrl: input.siteUrl,
  });
}
