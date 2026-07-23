/**
 * Prüft die Live-Bearbeitungslogik des Editors (liveApply) gegen ein
 * jsdom-Dokument - simuliert, was im Vorschau-iframe passiert, wenn eine
 * Person Farben/Texte ändert. Ergänzt den serverseitigen Render-Test.
 *
 * Ausführen: npm run test:editor
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { parseHtmlTemplate } from "../src/lib/html/parse";
import { renderHtml } from "../src/lib/html/render";
import { applyColor, applyText } from "../src/lib/html/liveApply";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` – ${detail}` : ""}`);
  }
}

function run(name: string, html: string) {
  console.log(`\n=== ${name} ===`);
  const parsed = parseHtmlTemplate(html);
  const initialHtml = renderHtml(parsed.templateHtml, parsed.contentState, parsed.detectedElements);
  const dom = new JSDOM(initialHtml);
  const doc = dom.window.document;
  // CSS.escape für jsdom bereitstellen
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
    escape: (s: string) => s.replace(/["\\]/g, "\\$&"),
  };

  // Text ändern
  const textEl = parsed.detectedElements.find((e) => e.kind === "text");
  if (textEl) {
    applyText(doc, textEl.id, "LIVE_TEXT_123");
    const node = doc.querySelector(`[data-edit-id="${textEl.id}"]`);
    check(`Text live geändert (${textEl.label})`, node?.textContent === "LIVE_TEXT_123");
  }

  // Farbe (Variable) ändern
  const varColor = parsed.detectedElements.find((e) => e.kind === "color" && e.id.startsWith("var:"));
  if (varColor) {
    applyColor(doc, varColor.id, "#010203", parsed.contentState.colors[varColor.id]);
    const name = varColor.id.slice(4);
    check(
      `CSS-Variable live gesetzt (${varColor.label})`,
      doc.documentElement.style.getPropertyValue(`--${name}`) === "#010203",
    );
  }

  return parsed;
}

run("Bloom Spirit", readFileSync("../Bloom Spirit.html", "utf8"));
run("malen-nach-zahlen", readFileSync("../malen-nach-zahlen-prototyp-v10.html", "utf8"));

// Literaler Farb-Modus (ohne CSS-Variablen)
console.log("\n=== Literale Farbe live ===");
const litHtml = `<!doctype html><html><head><style>
  body{background:#ABCDEF} h1{color:#abcdef}
</style></head><body><h1 style="border-color:#ABCDEF">Titel</h1></body></html>`;
const litParsed = parseHtmlTemplate(litHtml);
const litInitial = renderHtml(litParsed.templateHtml, litParsed.contentState, litParsed.detectedElements);
const litDom = new JSDOM(litInitial);
const litDoc = litDom.window.document;
const litColor = litParsed.detectedElements.find((e) => e.kind === "color")!;
applyColor(litDoc, litColor.id, "#00ff11", litParsed.contentState.colors[litColor.id]);
const styleText = litDoc.querySelector("style")?.textContent ?? "";
const h1Style = litDoc.querySelector("h1")?.getAttribute("style") ?? "";
check("literale Farbe im <style> live ersetzt (beide Schreibweisen)",
  !/#ABCDEF|#abcdef/.test(styleText) && (styleText.match(/#00ff11/g) ?? []).length === 2, styleText);
check("literale Farbe im style-Attribut live ersetzt", h1Style.includes("#00ff11"));

console.log(failures === 0 ? "\nAlle Editor-Prüfungen bestanden ✓" : `\n${failures} fehlgeschlagen ✗`);
process.exit(failures === 0 ? 0 : 1);
