/**
 * Prüft die Mehrsprachen-Unterstützung: Erkennung des I18N-Objekts,
 * Ausschluss der data-i18n-Elemente aus der statischen Text-Erkennung,
 * Live-Anwendung einer Sprache im Vorschau-DOM und das Zurückschreiben ins
 * Script (inkl. Ausführung durch die Seite selbst).
 *
 * Ausführen: npm run test:i18n
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { parseHtmlTemplate } from "../src/lib/html/parse";
import { renderHtml } from "../src/lib/html/render";
import { applyI18nLang } from "../src/lib/html/liveApply";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` – ${detail}` : ""}`);
  }
}

// Minimale mehrsprachige Seite nach dem Muster der echten SDG-Landingpages
const html = `<!doctype html><html lang="de"><head><style>:root{--c:#111}</style></head>
<body>
  <nav class="lang"><a data-lang="de" class="active">DE</a><a data-lang="en">EN</a><a data-lang="fr">FR</a></nav>
  <h1 data-i18n="title">Willkommen</h1>
  <p data-i18n="lead">Jetzt <b>anmelden</b></p>
  <button data-i18n="cta">Los geht's</button>
  <img data-i18n-alt="hero.alt" src="data:image/png;base64,iVBOR" alt="Held">
<script>
var I18N = {
  de: { 'title':'Willkommen', 'lead':'Jetzt \\u003cb>anmelden\\u003c/b>', 'cta':"Los geht's", 'hero.alt':'Held' },
  en: { 'title':'Welcome', 'lead':'Sign \\u003cb>up\\u003c/b> now', 'cta':"Let's go", 'hero.alt':'Hero' },
  fr: { 'title':'Bienvenue', 'lead':'Inscrivez-vous', 'cta':"C'est parti", 'hero.alt':'Héros' }
};
var LANG='de';
function applyLang(l){ var d=I18N[l]||I18N.de; LANG=l;
  var els=document.querySelectorAll('[data-i18n]'); for(var i=0;i<els.length;i++){var k=els[i].getAttribute('data-i18n'); if(d[k]!==undefined) els[i].innerHTML=d[k];}
  var a=document.querySelectorAll('[data-i18n-alt]'); for(i=0;i<a.length;i++){var ka=a[i].getAttribute('data-i18n-alt'); if(d[ka]!==undefined) a[i].alt=d[ka];}
}
applyLang('de');
</script>
</body></html>`;

console.log("=== Erkennung ===");
const parsed = parseHtmlTemplate(html);
check("3 Sprachen erkannt (de/en/fr)", JSON.stringify(parsed.languages) === '["de","en","fr"]',
  JSON.stringify(parsed.languages));
check("i18n im content_state vorhanden", !!parsed.contentState.i18n);
const textDefaults = parsed.detectedElements
  .filter((e) => e.kind === "text")
  .map((e) => e.default);
check(
  "data-i18n-Texte NICHT als statische Texte erkannt (nur die DE/EN/FR-Links)",
  !textDefaults.includes("Willkommen") &&
    !textDefaults.includes("Los geht's") &&
    textDefaults.every((t) => ["DE", "EN", "FR"].includes(t)),
  `gefundene Texte: ${JSON.stringify(textDefaults)}`,
);
check("Hinweis auf Mehrsprachigkeit im Bericht",
  parsed.warnings.some((w) => w.includes("Mehrsprachige Seite")));

console.log("\n=== Live-Anwendung im Vorschau-DOM (ohne Skripte) ===");
const preview = renderHtml(parsed.templateHtml, parsed.contentState, parsed.detectedElements);
const vc = new VirtualConsole();
const previewDom = new JSDOM(preview, { virtualConsole: vc });
const pdoc = previewDom.window.document;
applyI18nLang(pdoc, parsed.contentState.i18n!["en"]);
check("EN live angewendet (title)", pdoc.querySelector('[data-i18n="title"]')?.innerHTML === "Welcome");
check("EN live angewendet (alt-Attribut)",
  pdoc.querySelector('[data-i18n-alt="hero.alt"]')?.getAttribute("alt") === "Hero");

console.log("\n=== Bearbeiten + Zurückschreiben + Ausführung durch die Seite ===");
const edited = structuredClone(parsed.contentState);
edited.i18n!["en"]["cta"] = "GO NOW";
edited.i18n!["de"]["title"] = "Servus";
const rendered = renderHtml(parsed.templateHtml, edited, parsed.detectedElements);
const dom = new JSDOM(rendered, { runScripts: "dangerously", virtualConsole: vc });
const w = dom.window as unknown as { applyLang: (l: string) => void; document: Document };
check("nach Laden: DE-Änderung sichtbar",
  w.document.querySelector('[data-i18n="title"]')?.innerHTML === "Servus");
w.applyLang("en");
check("nach Umschalten auf EN: geänderter Button sichtbar",
  w.document.querySelector('[data-i18n="cta"]')?.innerHTML === "GO NOW");
w.applyLang("fr");
check("FR unverändert korrekt",
  w.document.querySelector('[data-i18n="cta"]')?.innerHTML === "C'est parti");
check("HTML in Übersetzung erhalten (EN lead enthält <b>)",
  (() => { w.applyLang("en"); return w.document.querySelector('[data-i18n="lead"]')?.innerHTML.includes("<b>") ?? false; })());

console.log(failures === 0 ? "\nAlle i18n-Prüfungen bestanden ✓" : `\n${failures} fehlgeschlagen ✗`);
process.exit(failures === 0 ? 0 : 1);
