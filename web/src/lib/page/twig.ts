import * as cheerio from "cheerio";
import { cleanHtml } from "@/lib/page/html";

/**
 * Export für das MiniCMS der Agentur: eine .twig-Vorlage, die alle Assets
 * als eigene Dateien über Twig lädt – statt einer gebündelten HTML-Datei.
 *
 *   <name>.twig
 *   assets/css/<name>.css     alle <style>-Blöcke
 *   assets/js/<name>-N.js     alle eingebetteten Skripte
 *   assets/img/bild-NN.ext    alle Bilder (aus dem Sites-Speicher und eingebettete)
 *
 * In der Vorlage stehen die Pfade als {{ asset('…') }} relativ zum
 * assets-Ordner; im CSS relativ zur CSS-Datei (../img/…).
 */

export interface TwigFile {
  path: string;
  content: string | Uint8Array;
}

export interface FetchedAsset {
  bytes: Uint8Array;
  ext: string;
}

/** Adressen von Bildern im Sites-Speicher und eingebettete Bilder. */
const ASSET_RE =
  /https?:\/\/[^"'()\s<>]+\/storage\/v1\/object\/public\/(?:ki-assets|project-images)\/[^"'()\s<>?#]+|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}/gi;

/** Skripte, die Daten statt Code enthalten, bleiben in der Vorlage. */
const DATA_SCRIPT = /^(application\/(ld\+)?json|importmap|text\/template)$/i;

/** Text so umschreiben, dass Twig ihn unverändert ausgibt ({{, {% und {#). */
export function escapeTwig(text: string): string {
  return text.replace(/\{[{%#]/g, (m) => `{{ '${m}' }}`);
}

const asset = (path: string) => `{{ asset('${path}') }}`;

export async function toTwigBundle(
  html: string,
  name: string,
  fetchAsset: (url: string) => Promise<FetchedAsset | null>,
): Promise<{ template: string; files: TwigFile[] }> {
  const $ = cheerio.load(cleanHtml(html));
  const files: TwigFile[] = [];

  // 1) Alle <style>-Blöcke → eine CSS-Datei (an der Stelle des ersten).
  const styles = $("style").toArray();
  let css = styles.map((el) => $(el).text().trim()).filter(Boolean).join("\n\n");
  if (styles.length) {
    $(styles[0]).replaceWith(`<link rel="stylesheet" href="__SDG_CSS__">`);
    styles.slice(1).forEach((el) => $(el).remove());
  }

  // 2) Eingebettete Skripte → eigene Dateien (Reihenfolge bleibt gleich).
  const scripts: string[] = [];
  $("script:not([src])").each((_, el) => {
    const type = $(el).attr("type") ?? "";
    if (DATA_SCRIPT.test(type)) return;
    const code = $(el).text();
    if (!code.trim()) return;
    scripts.push(code);
    const n = scripts.length;
    $(el).replaceWith(`<script${type === "module" ? ' type="module"' : ""} src="__SDG_JS_${n}__"></script>`);
  });

  // 3) Bilder als eigene Dateien.
  let page = $.html();
  const urls = [...new Set([...(page.match(ASSET_RE) ?? []), ...(css.match(ASSET_RE) ?? [])])];
  const imagePath = new Map<string, string>();
  for (const url of urls) {
    const got = await fetchAsset(url);
    if (!got) continue;
    const path = `img/bild-${String(imagePath.size + 1).padStart(2, "0")}.${got.ext}`;
    imagePath.set(url, path);
    files.push({ path: `assets/${path}`, content: got.bytes });
  }
  const tokens: string[] = [];
  page = page.replace(ASSET_RE, (url) => {
    const path = imagePath.get(url);
    if (!path) return url;
    tokens.push(path);
    return `__SDG_ASSET_${tokens.length - 1}__`;
  });
  css = css.replace(ASSET_RE, (url) => (imagePath.has(url) ? `../${imagePath.get(url)}` : url));

  // 4) Vorlage: Text für Twig absichern, dann die Asset-Aufrufe einsetzen.
  const template = escapeTwig(page)
    .replace("__SDG_CSS__", asset(`css/${name}.css`))
    .replace(/__SDG_JS_(\d+)__/g, (_, n) => asset(`js/${name}-${n}.js`))
    .replace(/__SDG_ASSET_(\d+)__/g, (_, i) => asset(tokens[Number(i)]));

  if (css) files.push({ path: `assets/css/${name}.css`, content: `${css}\n` });
  scripts.forEach((code, i) => files.push({ path: `assets/js/${name}-${i + 1}.js`, content: `${code.trim()}\n` }));
  files.push({
    path: "LIESMICH.txt",
    content: [
      `Landingpage „${name}“ – Export aus SDG Sites für das MiniCMS`,
      "",
      `${name}.twig            Vorlage (komplette Seite)`,
      css ? `assets/css/${name}.css  Styles` : null,
      scripts.length ? `assets/js/${name}-N.js   Skripte (in der Reihenfolge der Seite)` : null,
      imagePath.size ? "assets/img/             Bilder" : null,
      "",
      "Alle Assets werden in der Vorlage über {{ asset('…') }} geladen, relativ",
      "zum Ordner „assets“. Im CSS sind die Bildpfade relativ zur CSS-Datei (../img/…).",
    ]
      .filter((l) => l !== null)
      .join("\n") + "\n",
  });

  return { template, files };
}
