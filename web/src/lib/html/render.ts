import * as cheerio from "cheerio";
import type { ContentState, DetectedElement } from "@/types/database";
import { detectI18n, serializeI18n } from "@/lib/html/i18n";
import { customButtonHtml } from "@/lib/html/structure";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Erzeugt aus dem unveränderlichen templateHtml und dem aktuellen
 * Bearbeitungsstand (contentState) das fertige HTML - identisch genutzt
 * für die Live-Vorschau (iframe srcDoc) und den Export.
 *
 * - Texte/Bilder werden über die data-edit-id-Selektoren ersetzt.
 * - CSS-Variablen-Farben: gezieltes Ersetzen der `--name: wert`-Deklaration
 *   in allen <style>-Blöcken.
 * - Literale Farben (Fallback-Modus): alle Vorkommen des Original-Werts
 *   in <style>-Blöcken und style="..."-Attributen werden gemeinsam ersetzt
 *   (case-insensitiv); Skript-Inhalte bleiben unangetastet.
 */
export function renderHtml(
  templateHtml: string,
  contentState: ContentState,
  detectedElements: DetectedElement[],
): string {
  const $ = cheerio.load(templateHtml);

  // Übersetzungen: das I18N-Objekt im Script mit den aktuellen Werten
  // überschreiben, damit der Sprachumschalter der Seite sie anzeigt.
  if (contentState.i18n && Object.keys(contentState.i18n).length > 0) {
    const scripts = $("script").toArray();
    const scriptTexts = scripts.map((el) => $(el).text());
    const det = detectI18n(scriptTexts);
    if (det) {
      const original = scriptTexts[det.range.scriptIndex];
      const replaced =
        original.slice(0, det.range.start) +
        serializeI18n(contentState.i18n) +
        original.slice(det.range.end);
      $(scripts[det.range.scriptIndex]).text(replaced);
    }
  }

  for (const [id, value] of Object.entries(contentState.texts)) {
    $(`[data-edit-id="${id}"]`).text(value);
  }

  for (const [id, value] of Object.entries(contentState.images)) {
    $(`[data-edit-id="${id}"]`).attr("src", value);
  }

  for (const [id, value] of Object.entries(contentState.links ?? {})) {
    $(`[data-edit-id="${id}"]`).attr("href", value);
  }

  // Bestehende Textelemente zu einem Link machen (Inhalt in <a> einpacken).
  for (const [id, url] of Object.entries(contentState.wrapLinks ?? {})) {
    if (!url) continue;
    const el = $(`[data-edit-id="${id}"]`);
    if (el.length) {
      const inner = el.html() ?? "";
      const safeUrl = url.replace(/"/g, "&quot;");
      el.html(
        `<a data-wrap-link href="${safeUrl}" style="color:inherit;text-decoration:underline">${inner}</a>`,
      );
    }
  }

  // Selbst hinzugefügte Buttons hinter ihrer Ziel-Position einfügen.
  for (const button of contentState.customButtons ?? []) {
    const target = $(button.afterSelector).first();
    if (target.length) {
      target.after(customButtonHtml(button));
    }
  }

  const defaults = new Map(detectedElements.map((el) => [el.id, el.default]));
  const varReplacements: { name: string; value: string }[] = [];
  const literalReplacements: { original: string; value: string }[] = [];

  for (const [id, value] of Object.entries(contentState.colors)) {
    if (id.startsWith("var:")) {
      varReplacements.push({ name: id.slice(4), value });
    } else {
      const original = defaults.get(id);
      if (original && normalize(original) !== normalize(value)) {
        literalReplacements.push({ original, value });
      }
    }
  }

  const replaceInCss = (css: string): string => {
    let result = css;
    for (const { name, value } of varReplacements) {
      const re = new RegExp(`(--${escapeRegExp(name)}\\s*:\\s*)[^;}]+`, "g");
      result = result.replace(re, `$1${value}`);
    }
    for (const { original, value } of literalReplacements) {
      const re = new RegExp(escapeRegExp(original), "gi");
      result = result.replace(re, value);
    }
    return result;
  };

  if (varReplacements.length > 0 || literalReplacements.length > 0) {
    $("style").each((_, el) => {
      const css = $(el).text();
      const replaced = replaceInCss(css);
      if (replaced !== css) {
        $(el).text(replaced);
      }
    });

    if (literalReplacements.length > 0) {
      $("[style]").each((_, el) => {
        const style = $(el).attr("style") ?? "";
        const replaced = replaceInCss(style);
        if (replaced !== style) {
          $(el).attr("style", replaced);
        }
      });
    }
  }

  return $.html();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}
