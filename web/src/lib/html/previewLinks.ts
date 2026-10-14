/**
 * Sorgt dafür, dass Links/Buttons in einer Vorschau beim Klick in einem neuen
 * Browser-Tab öffnen (Ziel sichtbar), ohne die Vorschau selbst zu verlassen.
 * Fügt einmalig <base target="_blank"> in den <head> ein bzw. ergänzt ein
 * vorhandenes <base href> (z. B. bei Shopify-Seiten) um das Ziel.
 *
 * Nur für die Anzeige gedacht – NICHT im Export verwenden.
 */
export function withBlankLinks(html: string): string {
  const existing = /<base\b[^>]*>/i.exec(html);
  if (existing) {
    if (/\btarget\s*=/i.test(existing[0])) return html;
    return html.replace(existing[0], existing[0].replace(/<base\b/i, '<base target="_blank"'));
  }
  const base = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
  }
  return base + html;
}
