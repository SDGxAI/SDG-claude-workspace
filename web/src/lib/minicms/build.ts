import sharp from "sharp";
import { checkProject } from "./check";
import { collectAssetUrls, convertPage } from "./convert";
import { Issues, type Asset, type Issue, type MiniCmsFile, type TextUnit } from "./types";

/**
 * MiniCMS-Export als Ganzes: Seite umbauen, Bilder als Dateien (nur
 * JPG/PNG/SVG/MP4), Texte in DE/EN/FR, meta.json.twig, config.json, Readme –
 * und am Ende die automatische Prüfung.
 */

/** Store im MiniCMS je Marke (big und dickie sind aus echten Projekten bestätigt). */
const STORE_BY_BRAND: Record<string, string> = {
  BIG: "big",
  "Dickie Toys": "dickie",
  "SIMBA-DICKIE-GROUP": "sdg",
  AquaPlay: "aquaplay",
  Carson: "carson",
  Corolle: "corolle",
  Eichhorn: "eichhorn",
  "Jada Toys": "jada",
  Majorette: "majorette",
  Noris: "noris",
  Schipper: "schipper",
  Simba: "simba",
  Smoby: "smoby",
  Tamiya: "tamiya",
  Zoch: "zoch",
};
const CONFIRMED_STORES = new Set(["big", "dickie"]);

const LANGS = ["de", "en", "fr"] as const;
type Lang = (typeof LANGS)[number];

export interface BuildDeps {
  fetchAsset: (url: string) => Promise<Asset | null>;
  /** Übersetzt Einheiten; Ergebnis je Einheit gleich viele Teile – oder null. */
  translate: (units: TextUnit[], from: string, to: Lang) => Promise<(string[] | null)[]>;
}

export interface BuildResult {
  name: string;
  files: MiniCmsFile[];
  issues: Issue[];
}

function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function projectNames(title: string, brand: string | null): { name: string; store: string; token: string } {
  const store = STORE_BY_BRAND[brand ?? ""] ?? (slugify(brand ?? "") || "sdg");
  let slug = slugify(title) || "landingpage";
  const brandSlug = slugify(brand ?? "");
  if (brandSlug && slug.startsWith(`${brandSlug}_`)) slug = slug.slice(brandSlug.length + 1);
  if (slug.startsWith(`${store}_`)) slug = slug.slice(store.length + 1);
  const name = `${store}_${slug}`.slice(0, 48).replace(/_+$/, "");
  return { name, store, token: name };
}

async function normalizeAsset(asset: Asset): Promise<Asset> {
  let ext = asset.ext.toLowerCase().replace("jpeg", "jpg");
  if (["png", "jpg", "svg", "mp4"].includes(ext)) return { bytes: asset.bytes, ext };
  if (["webp", "avif", "gif", "bmp", "tif", "tiff", "heic", "heif"].includes(ext)) {
    const img = sharp(asset.bytes, { animated: false });
    const meta = await img.metadata();
    if (meta.hasAlpha) {
      ext = "png";
      return { bytes: new Uint8Array(await img.png({ compressionLevel: 9 }).toBuffer()), ext };
    }
    ext = "jpg";
    return { bytes: new Uint8Array(await img.jpeg({ quality: 86, mozjpeg: true }).toBuffer()), ext };
  }
  return { bytes: asset.bytes, ext };
}

function baseName(url: string, i: number): string {
  if (/^data:/i.test(url)) return `bild_${i + 1}`;
  const last = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  return slugify(last).slice(0, 40) || `bild_${i + 1}`;
}

function nest(pairs: [string, string][], issues: Issues): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of pairs) {
    const parts = key.split(".");
    let node = root;
    for (const p of parts.slice(0, -1)) {
      if (typeof node[p] === "string") {
        issues.error(`Interner Fehler: Text-Schlüssel ${key} überschneidet sich.`);
        node[p] = {};
      }
      node[p] = (node[p] as Record<string, unknown>) ?? {};
      node = node[p] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  return root;
}

function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [0, s, l];
}

function bannerColors(css: string): { accent: string; ink: string } {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const c = `#${m[1].toLowerCase()}`;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const accent = sorted.find((c) => {
    const [, s, l] = hexToHsl(c);
    return s > 0.4 && l > 0.25 && l < 0.65;
  });
  const ink = sorted.find((c) => hexToHsl(c)[2] < 0.3);
  return { accent: accent ?? "#e40613", ink: ink ?? "#222222" };
}

function readme(opts: {
  name: string;
  store: string;
  title: string;
  skus: { sku: string; label: string }[];
  fonts: string[];
  issues: Issue[];
  media: string[];
}): string {
  const open = opts.issues.filter((i) => i.level === "warn");
  return `# ${opts.title}

MiniCMS-Projekt \`${opts.name}\` (Store \`${opts.store}\`), erzeugt mit SDG Sites
am ${new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}.

## Dateien

| Datei | Inhalt |
| --- | --- |
| \`content.twig\` | Markup, alle Texte ueber \`| trans\`, alle Medien ueber \`media.get_asset_link()\` |
| \`content.css\` | Styles, Klassen mit Praefix \`${opts.name}__\` |
| \`content.js\` | ES-Modul, Bootstrap ueber \`import.meta.url\` (\`top_el_ref\`, \`top_el_ref_shadow_inner_dst\`) |
| \`translations/{de,en,fr}.json\` | Texte, identischer Key-Satz in allen drei Sprachen |
| \`meta.json.twig\` | Titel, SEO-Keywords, Beschreibung, Bannerfarben |
| \`config.json\` | Store \`${opts.store}\`, kein Matomo/Facebook |
| \`public/\` | Medien (${opts.media.length} Dateien, nur JPG/PNG/SVG/MP4) |

## Produktlinks

${
  opts.skus.length
    ? `Alle Produktlinks kommen aus der Shop-API ueber \`product.get_url(sku)\`.
Liefert die API keinen Link, entfaellt der Button bzw. die Verlinkung –
es gibt keinen Fallback und keine Produkt-URLs in den Uebersetzungen.

| SKU | Stelle |
| --- | --- |
${opts.skus.map((s) => `| \`${s.sku}\` | ${s.label.replace(/\|/g, "/")} |`).join("\n")}`
    : "Die Seite enthaelt keine Produktlinks."
}

## Umsetzung der MiniCMS-Vorgaben

- keine IDs im Markup; Sprungziele und Skripte nutzen \`data-${opts.name.replace(/_/g, "-")}-id\`
- wiederkehrende Bausteine (Karten, Listen) als \`{% for %}\`-Schleifen
- Newsletter ueber \`@shared/newsletter.twig\` (sofern die Seite ein Anmeldeformular hat)
- Kopf-/Fusszeile nur \`standalone.is_standalone()\`
- Layout ueber \`@container\` statt \`@media\` (\`@media\` nur fuer \`prefers-reduced-motion\`), \`vw\` als \`cqi\`
- keine eigenen Schriften, keine data:-URIs, kein Tracking, keine Fremd-Skripte, kein CDN
- \`content.js\` registriert nichts global und arbeitet nur im Shadow-Root;
  \`document\`/\`window\` sind im Seitencode auf das Projekt begrenzt
${
  opts.fonts.length
    ? `
## Schriften

Die Seite nutzt: ${opts.fonts.map((f) => `\`${f}\``).join(", ")}. Sie werden nicht
mitgeliefert (keine eigenen Fonts) und muessen vom MiniCMS bereitgestellt werden
(\`/d2s_managed/\`), sonst greift die Ersatzschrift.
`
    : ""
}${
  open.length
    ? `
## Offen

${open.map((i) => `- ${i.text}`).join("\n")}
`
    : ""
}`;
}

export async function buildMiniCms(opts: {
  html: string;
  title: string;
  brand: string | null;
  deps: BuildDeps;
}): Promise<BuildResult> {
  const issues = new Issues();
  const { name, store, token } = projectNames(opts.title, opts.brand);
  if (!CONFIRMED_STORES.has(store))
    issues.warn(`Store „${store}“ für die Marke ${opts.brand ?? "–"} ist geraten – bitte in config.json mit der D2S abgleichen.`);

  const conv = convertPage({ html: opts.html, name, token, issues });

  // Texte für meta.json.twig
  const firstLong = conv.units.map((u) => u.de.join(" ")).find((t) => t.length > 80) ?? "";
  const description = conv.meta.description || firstLong.slice(0, 160);
  if (!conv.meta.description) issues.info("Die Seite hatte keine Meta-Beschreibung – sie wurde aus dem ersten längeren Text übernommen.");
  const metaUnits: TextUnit[] = [
    { keys: ["title"], de: [conv.meta.title || opts.title] },
    { keys: ["seo_keywords"], de: [conv.meta.keywords || [opts.brand, opts.title].filter(Boolean).join(", ")] },
    { keys: ["description"], de: [description || opts.title] },
    { keys: ["banner_logo"], de: [opts.title] },
  ];
  const units = [...metaUnits, ...conv.units];

  // Nur Bilder holen, die die Vorlage wirklich nutzt
  const urls = collectAssetUrls(opts.html);
  const used = [...new Set([...`${conv.twig}`.matchAll(/__SDG_ASSET_(\d+)__/g)].map((m) => Number(m[1])))];

  const source = LANGS.includes(conv.sourceLang as Lang) ? (conv.sourceLang as Lang) : "de";
  const targets = LANGS.filter((l) => l !== source);

  const [assets, translated] = await Promise.all([
    Promise.all(
      used.map(async (i) => {
        const url = urls[i];
        try {
          const got = await opts.deps.fetchAsset(url);
          return { i, url, asset: got ? await normalizeAsset(got) : null };
        } catch {
          return { i, url, asset: null };
        }
      }),
    ),
    Promise.all(targets.map(async (lang) => ({ lang, out: await opts.deps.translate(units, source, lang) }))),
  ]);

  // Dateinamen in public/
  const files: MiniCmsFile[] = [];
  const paths = new Map<number, string>();
  const taken = new Set<string>();
  for (const { i, url, asset } of assets.sort((a, b) => a.i - b.i)) {
    const ext = asset?.ext ?? (/\.([a-z0-9]{3,4})(\?|$)/i.exec(url)?.[1].toLowerCase() ?? "png");
    let base = baseName(url, i);
    for (let n = 2; taken.has(`${base}.${ext}`); n++) base = `${baseName(url, i)}_${n}`;
    taken.add(`${base}.${ext}`);
    const path = `public/${base}.${ext}`;
    paths.set(i, path);
    if (asset) files.push({ path, content: asset.bytes });
    else issues.error(`Datei konnte nicht geladen werden: ${url.slice(0, 70)} – fehlt jetzt als ${path}.`);
  }
  const twig = conv.twig.replace(/__SDG_ASSET_(\d+)__/g, (_m, n: string) => paths.get(Number(n)) ?? "public/fehlt.png");

  // Übersetzungen
  const byLang: Record<string, [string, string][]> = { de: [], en: [], fr: [] };
  units.forEach((u) => u.keys.forEach((k, j) => byLang[source].push([k, u.de[j]])));
  for (const { lang, out } of translated) {
    let failed = 0;
    units.forEach((u, ui) => {
      const t = out[ui];
      if (!t) failed++;
      u.keys.forEach((k, j) => byLang[lang].push([k, t?.[j] ?? u.de[j]]));
    });
    if (failed) issues.error(`${failed} Texte konnten nicht nach ${lang.toUpperCase()} übersetzt werden und stehen dort noch auf ${source.toUpperCase()}.`);
  }

  const colors = bannerColors(conv.css);
  const meta = `{
\t"title": "{{ 'title' | trans | escape('js') }}",
\t"seo_keywords": "{{ 'seo_keywords' | trans | escape('js') }}",
\t"description": "{{ 'description' | trans | escape('js') }}",
\t"banner_bg": "#ffffff",
\t"banner_btn_fg": "${colors.ink}",
\t"banner_btn_bg": "${colors.accent}",
\t"banner_btn_text": "#ffffff",
\t"logo_img_alt": "{{ 'banner_logo' | trans | escape('js') }}"
}
`;

  files.unshift(
    { path: "content.twig", content: twig },
    { path: "content.css", content: conv.css },
    { path: "content.js", content: conv.js },
    ...LANGS.map((lang) => ({ path: `translations/${lang}.json`, content: JSON.stringify(nest(byLang[lang], issues), null, 1) + "\n" })),
    { path: "meta.json.twig", content: meta },
    { path: "config.json", content: `{\n\t"store": "${store}",\n\t"matomo_id": -1,\n\t"facebook_id": 0\n}\n` },
  );

  if (conv.fonts.length)
    issues.warn(`Schriften ${conv.fonts.slice(0, 4).join(", ")} werden nicht mitgeliefert – bitte mit der D2S klären, ob sie im MiniCMS verfügbar sind.`);
  issues.info("Bannerfarben in meta.json.twig wurden aus den Farben der Seite gewählt – bitte kurz prüfen.");

  checkProject(files, issues);

  files.push({
    path: "Readme.md",
    content: readme({
      name,
      store,
      title: opts.title,
      skus: conv.skus,
      fonts: conv.fonts,
      issues: issues.list,
      media: files.filter((f) => f.path.startsWith("public/")).map((f) => f.path),
    }),
  });

  const order = { error: 0, warn: 1, info: 2 } as const;
  return { name, files, issues: [...issues.list].sort((a, b) => order[a.level] - order[b.level]) };
}
