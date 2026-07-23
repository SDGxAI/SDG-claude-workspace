/**
 * Prüft die Export-Logik (Base64-Einbettung & relative Bildpfade) auf Basis
 * der reinen Render-/Transformationsfunktionen - ohne echtes Storage.
 *
 * Ausführen: npm run test:export
 */
import { readFileSync } from "node:fs";
import { parseHtmlTemplate } from "../src/lib/html/parse";
import { renderHtml } from "../src/lib/html/render";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` – ${detail}` : ""}`);
  }
}

// Bloom Spirit hat base64-Bilder -> Export als HTML soll diese behalten
const html = readFileSync("../Bloom Spirit.html", "utf8");
const parsed = parseHtmlTemplate(html);

console.log("=== Export HTML (Base64 eingebettet) ===");
const exported = renderHtml(parsed.templateHtml, parsed.contentState, parsed.detectedElements);
check("enthält eingebettete data:image-Bilder", exported.includes("data:image/"));
check("Skripte erhalten", (exported.match(/<script/g) ?? []).length === (html.match(/<script/g) ?? []).length);

console.log("\n=== Export ZIP (relative Pfade) ===");
// Simuliert die Umschreibung von Bild-Referenzen auf images/bild-N.ext
const relImages: Record<string, string> = {};
let n = 0;
for (const [id, v] of Object.entries(parsed.contentState.images)) {
  if (v.startsWith("data:")) {
    n += 1;
    relImages[id] = `images/bild-${n}.jpg`;
  } else {
    relImages[id] = v;
  }
}
const zipHtml = renderHtml(
  parsed.templateHtml,
  { ...parsed.contentState, images: relImages },
  parsed.detectedElements,
);
check(`${n} Bilder auf relative Pfade umgeschrieben`, n >= 3);
check("HTML referenziert images/bild-1.jpg", zipHtml.includes("images/bild-1.jpg"));
// <img>-Tags dürfen keine data:-URIs mehr enthalten (CSS-background-image
// bleibt eingebettet - das ist gewollt, da nicht als <img> erkannt).
check(
  "kein <img src=\"data:...\"> mehr im ZIP-HTML",
  !/<img[^>]+src="data:/i.test(zipHtml),
);

// Edit + Export: geänderte Farbe/Text landen im Export
const colorEl = parsed.detectedElements.find((e) => e.kind === "color")!;
const textEl = parsed.detectedElements.find((e) => e.kind === "text")!;
const editedExport = renderHtml(
  parsed.templateHtml,
  {
    ...parsed.contentState,
    colors: { ...parsed.contentState.colors, [colorEl.id]: "#654321" },
    texts: { ...parsed.contentState.texts, [textEl.id]: "EXPORT_TEXT" },
  },
  parsed.detectedElements,
);
check("geänderte Farbe im Export enthalten", editedExport.includes("#654321"));
check("geänderter Text im Export enthalten", editedExport.includes("EXPORT_TEXT"));

console.log(failures === 0 ? "\nAlle Export-Prüfungen bestanden ✓" : `\n${failures} fehlgeschlagen ✗`);
process.exit(failures === 0 ? 0 : 1);
