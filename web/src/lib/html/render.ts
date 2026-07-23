import * as cheerio from "cheerio";
import type { ContentState, DetectedElement } from "@/types/database";

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

  for (const [id, value] of Object.entries(contentState.texts)) {
    $(`[data-edit-id="${id}"]`).text(value);
  }

  for (const [id, value] of Object.entries(contentState.images)) {
    $(`[data-edit-id="${id}"]`).attr("src", value);
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
