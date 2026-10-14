import "server-only";
import * as cheerio from "cheerio";
import {
  callClaude,
  DEFAULT_AI_MODEL,
  effortToBudget,
  type Effort,
} from "@/lib/ai/editHtml";
import type { Fail, ShopifyConnection } from "@/lib/shopify/client";
import { listThemeFiles, readThemeFiles } from "@/lib/shopify/themes";
import type { ShopifyFileMap } from "@/types/database";

/** Obergrenze für den Kontext, den wir der KI schicken (Zeichen). */
const MAX_CONTEXT_CHARS = 220_000;
const MAX_LOCALE_CHARS = 80_000;
const MAX_SCHEMA_CHARS = 6_000;

type PathSeg = string | number;

export interface ThemeOp {
  op: "set" | "delete";
  file: string;
  path: PathSeg[];
  value?: unknown;
}

// ---------------------------------------------------------------------------
// JSON-Dateien von Shopify (mit optionalem /* … */-Kopfkommentar)
// ---------------------------------------------------------------------------

export function splitJsonFile(raw: string): { header: string; data: unknown } | null {
  const m = /^\s*\/\*[\s\S]*?\*\/\s*/.exec(raw);
  const header = m ? m[0] : "";
  try {
    return { header, data: JSON.parse(raw.slice(header.length)) };
  } catch {
    return null;
  }
}

export function serializeJsonFile(header: string, data: unknown): string {
  return `${header}${JSON.stringify(data, null, 2)}`;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type Container = Record<string, unknown> | unknown[];

function isContainer(v: unknown): v is Container {
  return typeof v === "object" && v !== null;
}

/** Wendet eine Operation auf ein JSON-Dokument an. Gibt false bei ungültigem Pfad. */
export function applyOp(doc: unknown, op: ThemeOp): boolean {
  if (!Array.isArray(op.path) || op.path.length === 0) return false;
  if (op.path.some((s) => typeof s === "string" && FORBIDDEN_KEYS.has(s))) return false;
  if (!isContainer(doc)) return false;

  let node: Container = doc;
  for (let i = 0; i < op.path.length - 1; i++) {
    const seg = op.path[i];
    const nextSeg = op.path[i + 1];
    const child = (node as Record<string, unknown>)[seg as string];
    if (isContainer(child)) {
      node = child;
      continue;
    }
    if (op.op === "delete") return false;
    const created: Container = typeof nextSeg === "number" ? [] : {};
    (node as Record<string, unknown>)[seg as string] = created;
    node = created;
  }

  const last = op.path[op.path.length - 1];
  if (op.op === "delete") {
    if (Array.isArray(node)) {
      const idx = Number(last);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) return false;
      node.splice(idx, 1);
      return true;
    }
    if (!(String(last) in node)) return false;
    delete (node as Record<string, unknown>)[String(last)];
    return true;
  }
  if (op.value === undefined) return false;
  if (Array.isArray(node)) {
    const idx = Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx > node.length) return false;
    node[idx] = op.value;
    return true;
  }
  (node as Record<string, unknown>)[String(last)] = op.value;
  return true;
}

// ---------------------------------------------------------------------------
// Kontext für die KI
// ---------------------------------------------------------------------------

/** Kurzüberblick der gerenderten Seite: Abschnitt-Schlüssel → sichtbarer Text. */
export function pageOutline(html: string): string {
  const $ = cheerio.load(html);
  const lines: string[] = [];
  $('[id^="shopify-section-"]').each((_, el) => {
    if (lines.length >= 40) return;
    const id = $(el).attr("id") ?? "";
    const raw = id.replace(/^shopify-section-/, "");
    const key = raw.includes("__") ? raw.slice(raw.lastIndexOf("__") + 2) : raw;
    const group = raw.startsWith("sections--") ? " (header/footer group)" : "";
    const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 220);
    const imgs = $(el).find("img").length;
    lines.push(`- ${key}${group}: "${text}"${imgs ? ` [${imgs} image(s)]` : ""}`);
  });
  return lines.join("\n");
}

/** Kompakte Fassung des {% schema %} einer Section (Einstellungen + Blöcke). */
export function extractSchema(liquid: string): string | null {
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(liquid);
  if (!m) return null;
  try {
    const schema = JSON.parse(m[1]) as {
      name?: string;
      settings?: Record<string, unknown>[];
      blocks?: { type?: string; name?: string; settings?: Record<string, unknown>[] }[];
      max_blocks?: number;
    };
    const slim = (settings?: Record<string, unknown>[]) =>
      (settings ?? [])
        .filter((s) => s.id)
        .map((s) => {
          const out: Record<string, unknown> = { id: s.id, type: s.type };
          if (Array.isArray(s.options)) {
            out.options = (s.options as { value?: unknown }[]).map((o) => o.value);
          }
          for (const k of ["min", "max", "step", "default"]) {
            if (s[k] !== undefined && typeof s[k] !== "object") out[k] = s[k];
          }
          return out;
        });
    const compact = {
      name: schema.name,
      settings: slim(schema.settings),
      blocks: (schema.blocks ?? []).map((b) => ({
        type: b.type,
        settings: slim(b.settings),
      })),
      max_blocks: schema.max_blocks,
    };
    return JSON.stringify(compact).slice(0, MAX_SCHEMA_CHARS);
  } catch {
    return null;
  }
}

function sectionTypes(data: unknown): string[] {
  const sections = (data as { sections?: Record<string, { type?: string }> })?.sections;
  if (!sections || typeof sections !== "object") return [];
  return Object.values(sections)
    .map((s) => s?.type)
    .filter((t): t is string => typeof t === "string" && !t.startsWith("shopify://"));
}

function extractJson(text: string): { ops?: ThemeOp[]; summary?: string } {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

const SYSTEM_PROMPT = `You edit a Shopify Online Store 2.0 theme of a SIMBA-DICKIE-GROUP shop. The theme is NOT live yet (preview only).
You get an INSTRUCTION (usually German), an outline of the rendered page, the theme's JSON files and the schemas of the sections used.
Files: templates/*.json (keys "sections" + "order"), sections/*.json (header/footer section groups, same structure), config/settings_data.json (global theme settings under "current"), locales/*.json (theme translations).

Return ONLY a JSON object, no markdown, no code fences:
{"ops":[{"op":"set","file":"templates/index.json","path":["sections","<section-key>","settings","heading"],"value":"Neuer Titel"}],"summary":"<one short German sentence describing what you changed>"}

Rules:
- "op" is "set" (create or replace the value at path; value may be any JSON incl. whole objects/arrays) or "delete" (remove a key or array element).
- "path" is an array of keys (and numeric array indexes) from the root of that file's JSON. For config/settings_data.json paths start with "current".
- Use the PAGE OUTLINE (section key → visible text) to find the right section. Only use setting ids and block types that exist in the given section schemas.
- Value formats: richtext → HTML like "<p>Text</p>" (lists: <ul><li>…</li></ul>); inline_richtext → HTML without <p>; text/textarea → plain text; url → "/collections/handle", "/pages/handle", "https://…" or "shopify://collections/handle"; image_picker → "shopify://shop_images/<filename>" (only filenames given in the instruction or already present); color → "#RRGGBB"; color_scheme → an existing scheme id from settings_data (e.g. "scheme-1"); checkbox → true/false; range/number → number within min/max matching step; select/radio → one of the listed options.
- Hide a section: set "disabled": true on it. Remove a section: delete it from "sections" AND set the new full "order" array without it.
- Add a section: add a new unique key in "sections" with {"type":"…","settings":{…},"blocks":{…},"block_order":[…]} and set the full "order" array with the new key at the right position. Blocks inside a section work the same way ("blocks" + "block_order").
- For visual tweaks that no setting covers, you may set "custom_css" on a section: an array of CSS rule strings, e.g. [".title { letter-spacing: 1px; }"] (scoped to the section automatically; no @import/@font-face; keep each section's CSS under 500 characters).
- Keep the language of existing texts. Make the smallest possible change and never touch unrelated settings.
- If the request cannot be done in these files (e.g. product titles/descriptions/prices, navigation menus, app settings or Liquid code changes), return {"ops":[],"summary":"<German explanation what has to be changed directly in Shopify instead>"}.`;

export type ThemeEditResult =
  | {
      ok: true;
      /** Neuer Inhalt der geänderten Dateien. */
      changed: ShopifyFileMap;
      /** Inhalt dieser Dateien VOR der Änderung. */
      originals: ShopifyFileMap;
      summary: string;
    }
  | Fail;

/**
 * Lässt Claude das Theme anhand einer Anweisung anpassen. Liefert die
 * geänderten Dateien (noch NICHT gespeichert – das macht der Aufrufer).
 */
export async function editShopifyThemeWithAI(input: {
  conn: ShopifyConnection;
  themeId: string;
  templateFile: string;
  pageHtml: string;
  instruction: string;
  model?: string;
  effort?: Effort;
}): Promise<ThemeEditResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Die KI-Funktion ist noch nicht eingerichtet (KI-Schlüssel fehlt). Bitte im Hosting einen ANTHROPIC_API_KEY hinterlegen.",
    };
  }

  // 1) Relevante JSON-Dateien finden und laden.
  const listed = await listThemeFiles(input.conn, input.themeId, [
    input.templateFile,
    "sections/*.json",
    "config/settings_data.json",
    "locales/*.default.json",
  ]);
  if (!listed.ok) return listed;
  const names = listed.files
    .filter((f) => f.filename.endsWith(".json"))
    .filter((f) => !f.filename.startsWith("locales/") || f.size <= MAX_LOCALE_CHARS)
    .map((f) => f.filename);
  if (!names.includes(input.templateFile)) {
    return {
      ok: false,
      error: `Die Vorlage „${input.templateFile}“ gibt es in diesem Theme nicht. Bitte im Projekt eine andere Vorlage wählen.`,
    };
  }
  const read = await readThemeFiles(input.conn, input.themeId, names);
  if (!read.ok) return read;

  const docs = new Map<string, { header: string; data: unknown; raw: string }>();
  for (const [filename, raw] of Object.entries(read.files)) {
    const parsed = splitJsonFile(raw);
    if (parsed) docs.set(filename, { ...parsed, raw });
  }
  if (!docs.has(input.templateFile)) {
    return { ok: false, error: `Die Vorlage „${input.templateFile}“ konnte nicht gelesen werden.` };
  }

  // 2) Schemas der verwendeten Sections laden.
  const types = new Set<string>();
  for (const [filename, doc] of docs) {
    if (filename.startsWith("templates/") || filename.startsWith("sections/")) {
      sectionTypes(doc.data).forEach((t) => types.add(t));
    }
  }
  const liquidNames = [...types].map((t) => `sections/${t}.liquid`);
  const liquid = liquidNames.length
    ? await readThemeFiles(input.conn, input.themeId, liquidNames)
    : { ok: true as const, files: {} as ShopifyFileMap };
  const schemas: string[] = [];
  if (liquid.ok) {
    for (const [filename, content] of Object.entries(liquid.files)) {
      const schema = extractSchema(content);
      if (schema) schemas.push(`=== SCHEMA ${filename} ===\n${schema}`);
    }
  }

  // 3) Kontext zusammenbauen (Reihenfolge = Wichtigkeit; Rest wird gekürzt).
  const fileBlocks: string[] = [];
  const ordered = [
    input.templateFile,
    ...[...docs.keys()].filter((f) => f.startsWith("sections/")),
    "config/settings_data.json",
    ...[...docs.keys()].filter((f) => f.startsWith("locales/")),
  ];
  for (const filename of ordered) {
    const doc = docs.get(filename);
    if (!doc) continue;
    if (filename === "config/settings_data.json") {
      const current = (doc.data as { current?: unknown })?.current;
      fileBlocks.push(
        `=== FILE ${filename} (only the "current" part is shown) ===\n${JSON.stringify({ current })}`,
      );
    } else {
      fileBlocks.push(`=== FILE ${filename} ===\n${JSON.stringify(doc.data)}`);
    }
  }

  const header =
    `INSTRUCTION:\n${input.instruction}\n\n` +
    `PAGE OUTLINE (rendered sections, key → visible text):\n${pageOutline(input.pageHtml) || "(none)"}\n\n`;
  let context = header + fileBlocks.join("\n\n") + "\n\nSECTION SCHEMAS:\n" + schemas.join("\n");
  if (context.length > MAX_CONTEXT_CHARS) {
    // Erst Übersetzungen weglassen, dann hart kürzen.
    const withoutLocales = fileBlocks.filter((b) => !b.startsWith("=== FILE locales/"));
    context = header + withoutLocales.join("\n\n") + "\n\nSECTION SCHEMAS:\n" + schemas.join("\n");
    if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS);
  }

  // 4) KI fragen.
  const res = await callClaude(
    apiKey,
    SYSTEM_PROMPT,
    context,
    8000,
    input.model?.trim() || DEFAULT_AI_MODEL,
    effortToBudget(input.effort),
  );
  if (!res.ok) return res;
  if (res.truncated) {
    return { ok: false, error: "Die Änderung war zu umfangreich für einen Schritt. Bitte in kleinere Schritte aufteilen." };
  }

  let parsed: { ops?: ThemeOp[]; summary?: string };
  try {
    parsed = extractJson(res.text);
  } catch {
    return { ok: false, error: "Die KI hat kein verwertbares Ergebnis geliefert. Bitte erneut versuchen." };
  }
  const ops = Array.isArray(parsed.ops) ? parsed.ops : [];
  const summary = (parsed.summary ?? "").trim();

  // 5) Operationen anwenden (nur auf geladene Dateien).
  const touched = new Set<string>();
  const failed: string[] = [];
  for (const op of ops) {
    const doc = docs.get(op?.file);
    if (!doc || (op.op !== "set" && op.op !== "delete")) {
      failed.push(String(op?.file ?? "?"));
      continue;
    }
    if (applyOp(doc.data, op)) touched.add(op.file);
    else failed.push(`${op.file}: ${(op.path ?? []).join(".")}`);
  }

  const changed: ShopifyFileMap = {};
  const originals: ShopifyFileMap = {};
  for (const filename of touched) {
    const doc = docs.get(filename)!;
    const next = serializeJsonFile(doc.header, doc.data);
    if (next !== doc.raw) {
      changed[filename] = next;
      originals[filename] = doc.raw;
    }
  }

  if (ops.length > 0 && Object.keys(changed).length === 0) {
    return {
      ok: false,
      error: `Die KI-Änderung passte nicht zum Theme (${failed.slice(0, 3).join(", ") || "keine gültigen Pfade"}). Bitte die Anweisung genauer formulieren.`,
    };
  }

  return {
    ok: true,
    changed,
    originals,
    summary: summary || (Object.keys(changed).length ? "Übernommen – schau dir die Vorschau an." : ""),
  };
}
