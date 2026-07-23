/**
 * Prüft die HTML-Erkennung gegen beide Beispiel-Landingpages im Repo-Root
 * (unterschiedliche Strukturen) sowie gegen einen synthetischen Fall ohne
 * CSS-Variablen (literaler Farb-Fallback).
 *
 * Ausführen: npm run test:parse
 */
import { readFileSync } from "node:fs";
import { parseHtmlTemplate } from "../src/lib/html/parse";
import { renderHtml } from "../src/lib/html/render";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` – ${detail}` : ""}`);
  }
}

function testFile(path: string, expectations: { minColors: number; minTexts: number; minImages: number }) {
  console.log(`\n=== ${path} ===`);
  const html = readFileSync(path, "utf8");
  const result = parseHtmlTemplate(html);

  console.log(
    `  Gefunden: ${result.counts.colors} Farben, ${result.counts.texts} Textfelder, ${result.counts.images} Bilder`,
  );
  for (const w of result.warnings) console.log(`  Hinweis: ${w}`);

  check(`mind. ${expectations.minColors} Farben`, result.counts.colors >= expectations.minColors);
  check(`mind. ${expectations.minTexts} Textfelder`, result.counts.texts >= expectations.minTexts);
  check(`mind. ${expectations.minImages} Bilder`, result.counts.images >= expectations.minImages);

  // Unverändertes Rendern: Skripte und Grundstruktur bleiben erhalten
  const rendered = renderHtml(result.templateHtml, result.contentState, result.detectedElements);
  const scriptCountBefore = (html.match(/<script/g) ?? []).length;
  const scriptCountAfter = (rendered.match(/<script/g) ?? []).length;
  check("Skripte bleiben erhalten", scriptCountBefore === scriptCountAfter,
    `${scriptCountBefore} vor, ${scriptCountAfter} nach Rendern`);

  // Farbe ändern und prüfen, dass sie im Ergebnis ankommt
  const firstColor = result.detectedElements.find((el) => el.kind === "color");
  if (firstColor) {
    const changed = renderHtml(
      result.templateHtml,
      {
        ...result.contentState,
        colors: { ...result.contentState.colors, [firstColor.id]: "#123456" },
      },
      result.detectedElements,
    );
    check(`Farbänderung (${firstColor.label}) wird angewendet`, changed.includes("#123456"));
  }

  // Text ändern und prüfen
  const firstText = result.detectedElements.find((el) => el.kind === "text");
  if (firstText) {
    const marker = "XX_TESTTEXT_XX";
    const changed = renderHtml(
      result.templateHtml,
      {
        ...result.contentState,
        texts: { ...result.contentState.texts, [firstText.id]: marker },
      },
      result.detectedElements,
    );
    check(`Textänderung (${firstText.label}) wird angewendet`, changed.includes(marker));
  }

  // Bild ersetzen und prüfen
  const firstImage = result.detectedElements.find((el) => el.kind === "image");
  if (firstImage) {
    const marker = "https://example.com/neues-bild.png";
    const changed = renderHtml(
      result.templateHtml,
      {
        ...result.contentState,
        images: { ...result.contentState.images, [firstImage.id]: marker },
      },
      result.detectedElements,
    );
    check(`Bildwechsel (${firstImage.label}) wird angewendet`, changed.includes(marker));
  }

  return result;
}

// Beide echte Beispieldateien (unterschiedliche Struktur, beide mit CSS-Variablen)
const bloom = testFile("../Bloom Spirit.html", { minColors: 5, minTexts: 5, minImages: 3 });
check(
  "Bloom Spirit: --wine als benannte Farbe erkannt",
  bloom.detectedElements.some((el) => el.id === "var:wine"),
);

const malen = testFile("../malen-nach-zahlen-prototyp-v10.html", {
  minColors: 5,
  minTexts: 5,
  minImages: 1,
});
check(
  "malen-nach-zahlen: --paper als benannte Farbe erkannt",
  malen.detectedElements.some((el) => el.id === "var:paper"),
);

// Synthetischer Fall: KEINE CSS-Variablen -> literaler Farb-Fallback
console.log("\n=== Synthetisch: ohne CSS-Variablen (Fallback) ===");
const noVars = `<!doctype html>
<html><head><style>
  body { background: #ABCDEF; color: rgb(1, 2, 3); }
  h1 { color: #abcdef; } /* Duplikat in anderer Schreibweise */
</style></head>
<body>
  <h1>Überschrift der Seite</h1>
  <p style="color:#FF0000">Roter Absatz mit etwas längerem Text zum Kürzen des Labels</p>
  <p>Hallo <strong>Welt</strong> gemischt</p>
  <img src="./lokal/bild.png" alt="Lokales Bild">
</body></html>`;

const synth = parseHtmlTemplate(noVars);
console.log(
  `  Gefunden: ${synth.counts.colors} Farben, ${synth.counts.texts} Textfelder, ${synth.counts.images} Bilder`,
);
for (const w of synth.warnings) console.log(`  Hinweis: ${w}`);

check("genau 3 deduplizierte Farben (#abcdef, rgb(1,2,3), #ff0000)", synth.counts.colors === 3,
  `erhalten: ${synth.counts.colors}`);
check("generische Labels (Farbe 1...)", synth.detectedElements.some((el) => el.label === "Farbe 1"));
check("gemischtes Element (<p>Hallo <strong>...) übersprungen", synth.counts.texts === 2,
  `erhalten: ${synth.counts.texts}`);
check("Warnung für gemischtes Element vorhanden",
  synth.warnings.some((w) => w.includes("nicht direkt editierbar")));
check("Warnung für lokalen Bild-Pfad vorhanden",
  synth.warnings.some((w) => w.includes("lokale Datei")));

// Duplikat-Ersetzung: Änderung von "Farbe 1" (#ABCDEF) muss BEIDE Schreibweisen treffen
const farbEl = synth.detectedElements.find((el) => el.label === "Farbe 1")!;
const changedSynth = renderHtml(
  synth.templateHtml,
  { ...synth.contentState, colors: { ...synth.contentState.colors, [farbEl.id]: "#00ff11" } },
  synth.detectedElements,
);
check(
  "beide Vorkommen (#ABCDEF und #abcdef) gemeinsam ersetzt",
  !/(#ABCDEF|#abcdef)/.test(changedSynth) && (changedSynth.match(/#00ff11/g) ?? []).length === 2,
);
// Inline-style-Farbe ersetzen
const inlineEl = synth.detectedElements.find((el) => el.default.toLowerCase() === "#ff0000")!;
const changedInline = renderHtml(
  synth.templateHtml,
  { ...synth.contentState, colors: { ...synth.contentState.colors, [inlineEl.id]: "#0000ff" } },
  synth.detectedElements,
);
check("Farbe im style-Attribut wird ersetzt", changedInline.includes('style="color:#0000ff"'));

console.log(failures === 0 ? "\nAlle Prüfungen bestanden ✓" : `\n${failures} Prüfung(en) fehlgeschlagen ✗`);
process.exit(failures === 0 ? 0 : 1);
