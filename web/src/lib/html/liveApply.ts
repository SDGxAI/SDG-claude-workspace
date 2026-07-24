import type { DetectedElement } from "@/types/database";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wendet eine Text-Änderung direkt auf das Dokument der Live-Vorschau an.
 */
export function applyText(doc: Document, id: string, value: string) {
  const el = doc.querySelector(`[data-edit-id="${cssEscape(id)}"]`);
  if (el) el.textContent = value;
}

/**
 * Wendet einen Bildwechsel direkt auf das Dokument der Live-Vorschau an.
 */
export function applyImage(doc: Document, id: string, value: string) {
  const el = doc.querySelector(`[data-edit-id="${cssEscape(id)}"]`);
  if (el) el.setAttribute("src", value);
}

/**
 * Setzt die Ziel-Adresse (href) eines Links live in der Vorschau.
 */
export function applyLink(doc: Document, id: string, value: string) {
  const el = doc.querySelector(`[data-edit-id="${cssEscape(id)}"]`);
  if (el) el.setAttribute("href", value);
}

/**
 * Wendet eine Farbänderung live an:
 * - CSS-Variablen (id "var:name") über setProperty am Wurzelelement.
 * - Literale Farben (id "lit:n") über Ersetzen des zuvor angewendeten Werts
 *   in allen <style>-Blöcken und style="..."-Attributen.
 *
 * `previousValue` ist der aktuell im Dokument sichtbare Wert dieser Farbe
 * (Ausgangswert oder letzter gesetzter Wert); wird für literale Farben zum
 * Auffinden der zu ersetzenden Stellen gebraucht.
 */
export function applyColor(
  doc: Document,
  id: string,
  value: string,
  previousValue: string,
) {
  if (id.startsWith("var:")) {
    const name = id.slice(4);
    doc.documentElement.style.setProperty(`--${name}`, value);
    return;
  }

  if (previousValue === value) return;
  const re = new RegExp(escapeRegExp(previousValue), "gi");

  doc.querySelectorAll("style").forEach((styleEl) => {
    const css = styleEl.textContent ?? "";
    if (re.test(css)) {
      re.lastIndex = 0;
      styleEl.textContent = css.replace(re, value);
    }
    re.lastIndex = 0;
  });

  doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const style = el.getAttribute("style") ?? "";
    if (re.test(style)) {
      re.lastIndex = 0;
      el.setAttribute("style", style.replace(re, value));
    }
    re.lastIndex = 0;
  });
}

/** Minimaler CSS.escape-Fallback für data-edit-id-Werte (nur el-/var-/lit-IDs). */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

export function isColorVar(el: DetectedElement): boolean {
  return el.id.startsWith("var:");
}

/**
 * Wendet eine Sprache auf die Vorschau an (die Vorschau führt keine Skripte
 * aus, deshalb setzen wir die Texte selbst - analog zur applyLang-Logik der
 * Seite): für jedes [data-i18n]/[data-i18n-*]-Element den passenden Wert.
 */
export function applyI18nLang(
  doc: Document,
  values: Record<string, string>,
) {
  doc.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n")!;
    if (values[key] !== undefined) el.innerHTML = values[key];
  });
  doc.querySelectorAll<HTMLElement>("[data-i18n-ph]").forEach((el) => {
    const key = el.getAttribute("data-i18n-ph")!;
    if (values[key] !== undefined) el.setAttribute("placeholder", values[key]);
  });
  doc.querySelectorAll<HTMLElement>("[data-i18n-alt]").forEach((el) => {
    const key = el.getAttribute("data-i18n-alt")!;
    if (values[key] !== undefined) el.setAttribute("alt", values[key]);
  });
  doc.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria")!;
    if (values[key] !== undefined) el.setAttribute("aria-label", values[key]);
  });
  doc.querySelectorAll<HTMLElement>("[data-i18n-href]").forEach((el) => {
    const key = el.getAttribute("data-i18n-href")!;
    if (values[key] !== undefined) el.setAttribute("href", values[key]);
  });
}

/** Setzt einen einzelnen Übersetzungswert live in der Vorschau. */
export function applyI18nValue(doc: Document, key: string, value: string) {
  doc.querySelectorAll<HTMLElement>(`[data-i18n="${cssEscape(key)}"]`).forEach(
    (el) => {
      el.innerHTML = value;
    },
  );
  doc.querySelectorAll<HTMLElement>(`[data-i18n-ph="${cssEscape(key)}"]`).forEach(
    (el) => el.setAttribute("placeholder", value),
  );
}
