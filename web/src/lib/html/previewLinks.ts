/**
 * Sorgt dafür, dass Links/Buttons in einer Vorschau beim Klick in einem neuen
 * Browser-Tab öffnen (Ziel sichtbar), ohne die Vorschau selbst zu verlassen.
 * Fügt einmalig <base target="_blank"> in den <head> ein.
 *
 * Nur für die Anzeige gedacht – NICHT im Export verwenden.
 */
export function withBlankLinks(html: string): string {
  const base = '<base target="_blank">';
  if (/<base\b/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
  }
  return base + html;
}
