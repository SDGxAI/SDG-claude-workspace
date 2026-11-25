import Twig from "twig";
import type { Issues, MiniCmsFile } from "./types";

/**
 * Automatische Kontrolle des fertigen Projekts – dieselben Punkte, auf die
 * die Agentur bzw. die D2S schaut. Rendert die Vorlage einmal mit
 * nachgebauten MiniCMS-Funktionen (Twig.js), um Syntaxfehler und fehlende
 * Übersetzungen zu finden.
 */

const ALLOWED_MEDIA = /\.(png|jpe?g|svg|mp4)$/i;

let sharedReady = false;
let missing: Set<string> | null = null;
let dict: Record<string, unknown> = {};

function lookup(key: string): string | undefined {
  const v = key.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), dict);
  return typeof v === "string" ? v : undefined;
}

function setup() {
  if (sharedReady) return;
  sharedReady = true;
  Twig.cache(false);
  Twig.extendFilter("trans", (value: string) => {
    const v = lookup(String(value));
    if (v === undefined) missing?.add(String(value));
    return v ?? "";
  });
  Twig.twig({
    id: "@shared/buttonlink.twig",
    allowInlineIncludes: true,
    data: "<a class='minicms_button {% block button_extra_classes %}{% endblock %}' href='{% block link %}{% endblock %}'>{% block button_text %}{% endblock %}</a>",
  });
  Twig.twig({
    id: "@shared/newsletter.twig",
    allowInlineIncludes: true,
    data: "<form>{% block newsletter_headline %}{% endblock %}{% block newsletter_description %}{% endblock %}</form>",
  });
}

function text(files: MiniCmsFile[], path: string): string {
  const f = files.find((x) => x.path === path);
  return f && typeof f.content === "string" ? f.content : "";
}

function flatKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatKeys(v, prefix ? `${prefix}.${k}` : k));
}

export function checkProject(files: MiniCmsFile[], issues: Issues): void {
  setup();
  const twig = text(files, "content.twig");
  const css = text(files, "content.css");

  // Übersetzungen: gleiche Schlüssel, nichts leer
  const langs: Record<string, Record<string, unknown>> = {};
  for (const lang of ["de", "en", "fr"]) {
    try {
      langs[lang] = JSON.parse(text(files, `translations/${lang}.json`) || "{}");
    } catch {
      issues.error(`translations/${lang}.json ist kein gültiges JSON.`);
      langs[lang] = {};
    }
  }
  const deKeys = flatKeys(langs.de);
  for (const lang of ["en", "fr"]) {
    const keys = new Set(flatKeys(langs[lang]));
    const miss = deKeys.filter((k) => !keys.has(k));
    if (miss.length) issues.error(`In ${lang}.json fehlen ${miss.length} Texte (z. B. ${miss[0]}).`);
  }
  for (const lang of ["de", "en", "fr"]) {
    dict = langs[lang];
    const empty = flatKeys(langs[lang]).filter((k) => !lookup(k)?.trim());
    if (empty.length) issues.error(`In ${lang}.json sind ${empty.length} Texte leer (z. B. ${empty[0]}).`);
  }

  // Vorlage rendern (Shop-Ansicht und Standalone)
  dict = langs.de;
  try {
    const template = Twig.twig({ data: twig, allowInlineIncludes: true, rethrow: true });
    for (const standalone of [true, false]) {
      missing = new Set();
      template.render({
        media: { get_asset_link: (p: string) => `/assets/${p}` },
        product: { get_url: (sku: string) => `https://shop.example/${sku}` },
        standalone: { is_standalone: () => standalone },
      });
      if (missing.size) issues.error(`Die Vorlage nutzt Texte, die in den Übersetzungen fehlen (${[...missing].slice(0, 3).join(", ")}).`);
    }
  } catch (err) {
    issues.error(`Die Twig-Vorlage ist fehlerhaft: ${(err as { message?: string }).message ?? String(err)}`);
  } finally {
    missing = null;
  }

  // Regeln aus AGENTS.md
  const withoutSvg = twig.replace(/<svg[\s\S]*?<\/svg>/gi, "");
  if (/\sid="/i.test(withoutSvg)) issues.error("Im Markup stehen noch IDs – das Projekt muss mehrfach einbettbar sein.");
  if (/data:[a-z]+\/[a-z0-9.+-]+[;,]/i.test(twig + css)) issues.error("Es sind noch eingebettete Dateien (data:-Adressen) enthalten.");
  if (/supabase\.co/i.test(twig + css + text(files, "content.js"))) issues.error("Es zeigen noch Adressen auf den SDG-Sites-Speicher (Supabase).");
  if (/<script/i.test(twig)) issues.error("In der Vorlage steht noch ein <script>.");
  if (/@font-face/i.test(css)) issues.error("Im CSS stehen noch eigene Schriften (@font-face).");
  for (const m of css.matchAll(/@media\s+([^{]+)\{/gi)) {
    if (!/prefers-reduced-motion/i.test(m[1])) issues.error(`Im CSS steht @media ${m[1].trim()} – erlaubt ist nur prefers-reduced-motion.`);
  }
  if (/url\(\s*['"]?https?:/i.test(css)) issues.warn("Das CSS lädt etwas von einer fremden Adresse.");

  const media = files.filter((f) => f.path.startsWith("public/"));
  for (const f of media) {
    if (!ALLOWED_MEDIA.test(f.path)) issues.error(`Dateityp nicht erlaubt: ${f.path} (erlaubt: JPG, PNG, SVG, MP4).`);
  }
  const size = media.reduce((s, f) => s + (typeof f.content === "string" ? f.content.length : f.content.byteLength), 0);
  if (size > 8 * 1024 * 1024) issues.warn(`Die Bilder sind zusammen ${(size / 1024 / 1024).toFixed(1)} MB groß – bitte prüfen, ob kleinere Dateien reichen.`);
}
