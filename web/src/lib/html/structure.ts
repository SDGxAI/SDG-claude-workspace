import * as cheerio from "cheerio";
import type { CustomButton } from "@/types/database";

export interface InsertionPoint {
  /** CSS-Selektor auf ein Element im Template. */
  selector: string;
  /** Menschlich lesbares Label (Position auf der Seite). */
  label: string;
}

function shorten(text: string, max = 40): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)} …` : t;
}

/**
 * Liefert mögliche Einfüge-Positionen für neue Buttons in Seitenreihenfolge:
 * alle Elemente mit data-edit-id (Texte/Links/Bilder) oder data-i18n
 * (übersetzte Texte). Jeder Punkt hat einen stabilen CSS-Selektor.
 */
export function computeInsertionPoints(templateHtml: string): InsertionPoint[] {
  const $ = cheerio.load(templateHtml);
  const points: InsertionPoint[] = [];
  const seen = new Set<string>();

  $("[data-edit-id], [data-i18n]").each((_, el) => {
    const $el = $(el);
    const editId = $el.attr("data-edit-id");
    const i18nKey = $el.attr("data-i18n");
    const selector = editId
      ? `[data-edit-id="${editId}"]`
      : `[data-i18n="${i18nKey}"]`;
    if (seen.has(selector)) return;
    seen.add(selector);

    const tag = "tagName" in el ? String(el.tagName).toUpperCase() : "";
    const text = shorten($el.text());
    const label = `${tag}${text ? `: ${text}` : i18nKey ? `: ${i18nKey}` : ""}`;
    points.push({ selector, label });
  });

  return points;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Erzeugt das HTML eines selbst hinzugefügten Buttons (für Render/Export). */
export function customButtonHtml(button: CustomButton): string {
  const style = [
    "display:inline-block",
    "margin:12px 0",
    "padding:12px 22px",
    `background:${escapeHtml(button.color || "#E30613")}`,
    "color:#ffffff",
    "text-decoration:none",
    "border-radius:8px",
    "font-weight:600",
  ].join(";");
  return `<a data-custom-btn="${escapeHtml(button.id)}" href="${escapeHtml(button.url)}" style="${style}">${escapeHtml(button.label)}</a>`;
}
