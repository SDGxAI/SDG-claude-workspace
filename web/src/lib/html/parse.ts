import * as cheerio from "cheerio";
import type { ContentState, DetectedElement } from "@/types/database";
import { detectI18n } from "@/lib/html/i18n";

export interface ParseResult {
  /** HTML mit data-edit-id-Attributen an allen erkannten Elementen. */
  templateHtml: string;
  detectedElements: DetectedElement[];
  contentState: ContentState;
  counts: { colors: number; texts: number; images: number; links: number };
  /** Gefundene Sprachen (falls die Seite ein Übersetzungs-Objekt nutzt). */
  languages: string[];
  /** Hinweise für den Import-Bericht (z. B. nicht auflösbare Datei-Pfade). */
  warnings: string[];
}

/** Hex- oder rgb()/rgba()-Farbwert. */
const COLOR_VALUE_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

/** CSS-Custom-Property mit Farbwert, z. B. `--wine: #A62A3C`. */
const CUSTOM_PROP_RE = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g;

/** Tags, deren direkter Textinhalt als editierbares Feld angeboten wird. */
const TEXT_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "button", "a", "span"];

function normalizeColor(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function firstWords(text: string, count = 6): string {
  const words = text.split(/\s+/);
  const head = words.slice(0, count).join(" ");
  return words.length > count ? `${head} …` : head;
}

/**
 * Analysiert eine hochgeladene HTML-Datei und erkennt editierbare Elemente:
 *
 * - Farben: bevorzugt CSS-Custom-Properties (`--name: #hex`) aus allen
 *   <style>-Blöcken; gibt es keine, werden alle literalen Hex-/RGB-Werte
 *   aus <style>-Blöcken und style="..."-Attributen gesammelt (dedupliziert,
 *   generisch "Farbe 1..N" benannt).
 * - Texte: h1-h6/p/button/a/span mit nicht-leerem DIREKTEM Textinhalt.
 *   Elemente mit gemischtem Inhalt (Text + verschachtelte Tags) werden
 *   bewusst übersprungen, damit beim Speichern kein Markup verloren geht.
 * - Bilder: alle <img>-Tags (Datei-Pfad oder data:-URI); relative Pfade,
 *   die außerhalb der Original-Umgebung nicht auflösbar sind, erzeugen
 *   eine Warnung für den Import-Bericht.
 *
 * Erkannte Text-/Bild-Elemente werden per data-edit-id im zurückgegebenen
 * templateHtml markiert; alles andere (Skripte, Struktur, Attribute)
 * bleibt unangetastet.
 */
export function parseHtmlTemplate(html: string): ParseResult {
  const $ = cheerio.load(html);
  const detectedElements: DetectedElement[] = [];
  const contentState: ContentState = { colors: {}, texts: {}, images: {} };
  const warnings: string[] = [];

  // ---------------------------------------------------------------
  // Mehrsprachigkeit (Übersetzungs-Objekt im Script)
  // ---------------------------------------------------------------
  const scriptTexts: string[] = [];
  $("script").each((_, el) => {
    scriptTexts.push($(el).text());
  });
  const i18n = detectI18n(scriptTexts);
  const languages: string[] = i18n ? i18n.langs : [];
  if (i18n) {
    contentState.i18n = i18n.data;
  }

  // ---------------------------------------------------------------
  // Farben
  // ---------------------------------------------------------------
  const styleTexts: string[] = [];
  $("style").each((_, el) => {
    styleTexts.push($(el).text());
  });

  const varColors = new Map<string, string>();
  for (const css of styleTexts) {
    for (const match of css.matchAll(CUSTOM_PROP_RE)) {
      const [, name, value] = match;
      if (!varColors.has(name)) {
        varColors.set(name, value);
      }
    }
  }

  if (varColors.size > 0) {
    for (const [name, value] of varColors) {
      const id = `var:${name}`;
      detectedElements.push({ id, kind: "color", label: `--${name}`, default: value });
      contentState.colors[id] = value;
    }
  } else {
    // Fallback: literale Farbwerte sammeln (dedupliziert, Groß-/Klein-
    // schreibung und Leerraum ignorierend).
    const seen = new Set<string>();
    const literals: string[] = [];
    const collect = (text: string) => {
      for (const match of text.matchAll(COLOR_VALUE_RE)) {
        const norm = normalizeColor(match[0]);
        if (!seen.has(norm)) {
          seen.add(norm);
          literals.push(match[0]);
        }
      }
    };
    for (const css of styleTexts) collect(css);
    $("[style]").each((_, el) => collect($(el).attr("style") ?? ""));

    literals.forEach((value, index) => {
      const id = `lit:${index + 1}`;
      detectedElements.push({
        id,
        kind: "color",
        label: `Farbe ${index + 1}`,
        default: value,
      });
      contentState.colors[id] = value;
    });
  }

  // ---------------------------------------------------------------
  // Texte
  // ---------------------------------------------------------------
  let elementCounter = 0;
  let skippedMixed = 0;

  $(TEXT_TAGS.join(",")).each((_, el) => {
    // Von der Übersetzung verwaltete Elemente (data-i18n) werden separat
    // über die Sprach-Umschaltung bearbeitet, nicht als statische Texte.
    if ($(el).attr("data-i18n") !== undefined) return;

    const children = "children" in el ? el.children : [];
    const directText = children
      .filter((node) => node.type === "text")
      .map((node) => ("data" in node ? node.data : ""))
      .join("");
    const trimmed = directText.replace(/\s+/g, " ").trim();
    if (!trimmed) return;

    const hasElementChild = children.some((node) => node.type === "tag");
    if (hasElementChild) {
      skippedMixed += 1;
      return;
    }

    elementCounter += 1;
    const id = `el-${elementCounter}`;
    $(el).attr("data-edit-id", id);
    detectedElements.push({
      id,
      kind: "text",
      label: `${("tagName" in el ? el.tagName : "text").toUpperCase()}: ${firstWords(trimmed)}`,
      default: trimmed,
    });
    contentState.texts[id] = trimmed;
  });

  if (skippedMixed > 0) {
    warnings.push(
      `${skippedMixed} Textelement(e) kombinieren Text mit Formatierung/Symbolen und sind deshalb nicht direkt editierbar.`,
    );
  }

  // ---------------------------------------------------------------
  // Bilder
  // ---------------------------------------------------------------
  let imageCounter = 0;
  $("img").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") ?? "";
    imageCounter += 1;
    elementCounter += 1;
    const id = `el-${elementCounter}`;
    $el.attr("data-edit-id", id);

    const alt = ($el.attr("alt") ?? "").trim();
    const label = alt ? `Bild: ${firstWords(alt, 4)}` : `Bild ${imageCounter}`;
    detectedElements.push({ id, kind: "image", label, default: src });
    contentState.images[id] = src;

    if (src && !src.startsWith("data:") && !/^https?:\/\//i.test(src)) {
      warnings.push(
        `${label} verweist auf eine lokale Datei ("${src}"), die nicht mit hochgeladen wurde – das Bild wird nicht angezeigt, bis es ersetzt wird.`,
      );
    }
  });

  // ---------------------------------------------------------------
  // Links (href von <a>) - Ziel-Adressen editierbar machen
  // ---------------------------------------------------------------
  let linkCounter = 0;
  $("a[href]").each((_, el) => {
    const $el = $(el);
    // Von der Übersetzung verwaltete Links (data-i18n-href) werden über die
    // Sprach-Umschaltung bearbeitet, nicht hier. Sprach-Umschalter (data-lang)
    // sind ebenfalls keine Content-Links.
    if ($el.attr("data-i18n-href") !== undefined) return;
    if ($el.attr("data-lang") !== undefined) return;

    const href = ($el.attr("href") ?? "").trim();
    // javascript:-Handler und leere Anker überspringen (keine echten Ziele).
    if (!href || /^javascript:/i.test(href)) return;

    // Vorhandene data-edit-id (aus der Text-Erkennung) wiederverwenden,
    // damit dasselbe Element für Beschriftung UND Ziel-Adresse zählt.
    let id = $el.attr("data-edit-id");
    if (!id) {
      elementCounter += 1;
      id = `el-${elementCounter}`;
      $el.attr("data-edit-id", id);
    }

    linkCounter += 1;
    const linkText = $el.text().replace(/\s+/g, " ").trim();
    const label = linkText
      ? `Link: ${firstWords(linkText, 5)}`
      : `Link ${linkCounter}`;
    detectedElements.push({ id, kind: "link", label, default: href });
    if (!contentState.links) contentState.links = {};
    contentState.links[id] = href;
  });

  // Nicht auflösbare externe Stylesheets (typisch bei "Webseite speichern
  // unter"-Exporten) im Bericht erwähnen - betrifft meist Schriftarten.
  $("link[rel='stylesheet']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href && !/^https?:\/\//i.test(href)) {
      warnings.push(
        `Die Datei verweist auf ein lokales Stylesheet ("${href}"), das nicht mit hochgeladen wurde – Schriftarten/Stile daraus können fehlen.`,
      );
    }
  });

  if (languages.length > 0) {
    warnings.push(
      `Mehrsprachige Seite erkannt (${languages.map((l) => l.toUpperCase()).join(", ")}). Die Texte lassen sich im Editor pro Sprache umschalten und bearbeiten.`,
    );
  }

  return {
    templateHtml: $.html(),
    detectedElements,
    contentState,
    counts: {
      colors: Object.keys(contentState.colors).length,
      texts: Object.keys(contentState.texts).length,
      images: Object.keys(contentState.images).length,
      links: Object.keys(contentState.links ?? {}).length,
    },
    languages,
    warnings,
  };
}
