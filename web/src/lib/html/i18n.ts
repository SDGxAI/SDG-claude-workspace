import * as acorn from "acorn";
import * as cheerio from "cheerio";

/** Übersetzungen: Sprache -> Schlüssel -> Wert. */
export type I18nData = Record<string, Record<string, string>>;

const I18N_ATTRS = [
  "data-i18n",
  "data-i18n-ph",
  "data-i18n-alt",
  "data-i18n-aria",
  "data-i18n-href",
];

/**
 * Liefert die Übersetzungs-Schlüssel in der Reihenfolge, in der sie im
 * Dokument vorkommen (oben nach unten). So lassen sich die Editor-Felder
 * in der tatsächlichen Seitenreihenfolge anzeigen (JSON-Speicherung erhält
 * die Schlüsselreihenfolge nicht).
 */
export function extractI18nKeyOrder(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const order: string[] = [];
  $("*").each((_, el) => {
    for (const attr of I18N_ATTRS) {
      const v = $(el).attr(attr);
      if (v && !seen.has(v)) {
        seen.add(v);
        order.push(v);
      }
    }
  });
  return order;
}

export interface I18nDetection {
  data: I18nData;
  /** Reihenfolge der Sprachen (wie im Objekt gefunden). */
  langs: string[];
  /** Reihenfolge der Schlüssel (aus der ersten Sprache). */
  keys: string[];
  /** Byte-Bereich des Objekt-Literals im Script (für das Zurückschreiben). */
  range: { scriptIndex: number; start: number; end: number };
}

const LANG_CODE_RE = /^[a-z]{2}(-[a-z]{2})?$/i;

type AcornNode = acorn.Node & Record<string, unknown>;

function isStringLiteralObject(node: AcornNode): Record<string, string> | null {
  if (node.type !== "ObjectExpression") return null;
  const out: Record<string, string> = {};
  for (const prop of node.properties as AcornNode[]) {
    if (prop.type !== "Property") return null;
    const key = prop.key as AcornNode;
    const value = prop.value as AcornNode;
    const keyName =
      key.type === "Identifier"
        ? (key.name as string)
        : key.type === "Literal"
          ? String(key.value)
          : null;
    if (keyName === null) return null;
    if (value.type !== "Literal" || typeof value.value !== "string") return null;
    out[keyName] = value.value as string;
  }
  return out;
}

/**
 * Findet in einem Script ein Übersetzungs-Objekt der Form
 * `{ de: { 'key': 'text', ... }, en: {...}, fr: {...} }` und liest es aus.
 * Erkennt das Objekt daran, dass mindestens zwei seiner obersten Schlüssel
 * wie Sprachcodes aussehen und auf Objekte aus reinen String-Werten zeigen.
 */
function findI18nInScript(script: string): Omit<I18nDetection, "range"> & {
  start: number;
  end: number;
} | null {
  let ast: acorn.Node;
  try {
    ast = acorn.parse(script, { ecmaVersion: "latest", ranges: true });
  } catch {
    return null;
  }

  let found:
    | (Omit<I18nDetection, "range"> & { start: number; end: number })
    | null = null;

  function consider(node: AcornNode) {
    if (found || node.type !== "ObjectExpression") return;
    const props = node.properties as AcornNode[];
    const data: I18nData = {};
    const langs: string[] = [];
    let langLike = 0;
    for (const prop of props) {
      if (prop.type !== "Property") return;
      const key = prop.key as AcornNode;
      const keyName =
        key.type === "Identifier"
          ? (key.name as string)
          : key.type === "Literal"
            ? String(key.value)
            : null;
      if (keyName === null) return;
      const inner = isStringLiteralObject(prop.value as AcornNode);
      if (!inner) return; // jede oberste Eigenschaft muss ein String-Objekt sein
      data[keyName] = inner;
      langs.push(keyName);
      if (LANG_CODE_RE.test(keyName)) langLike += 1;
    }
    if (langs.length >= 2 && langLike >= 2) {
      const keys = Object.keys(data[langs[0]]);
      const range = (node as unknown as { start: number; end: number });
      found = { data, langs, keys, start: range.start, end: range.end };
    }
  }

  function walk(node: AcornNode | null) {
    if (!node || typeof node !== "object" || found) return;
    if (typeof node.type === "string") consider(node);
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "range")
        continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c as AcornNode);
      } else if (child && typeof child === "object" && "type" in child) {
        walk(child as AcornNode);
      }
    }
  }

  walk(ast as AcornNode);
  return found;
}

/**
 * Durchsucht die Inhalte aller <script>-Blöcke nach einem Übersetzungs-Objekt.
 * `scripts` ist die Liste der Script-Textinhalte in Dokumentreihenfolge.
 */
export function detectI18n(scripts: string[]): I18nDetection | null {
  for (let i = 0; i < scripts.length; i++) {
    const hit = findI18nInScript(scripts[i]);
    if (hit) {
      return {
        data: hit.data,
        langs: hit.langs,
        keys: hit.keys,
        range: { scriptIndex: i, start: hit.start, end: hit.end },
      };
    }
  }
  return null;
}

/**
 * Serialisiert die Uebersetzungen als JS-Objekt-Literal (JSON ist gueltiges JS).
 * "<" wird kodiert, damit ein in einem Wert enthaltenes "</script>" das Script
 * nicht vorzeitig schliesst; U+2028/U+2029 werden ebenfalls kodiert (in
 * JS-Strings sonst ungueltig).
 */
export function serializeI18n(data: I18nData): string {
  return JSON.stringify(data, null, 1)
    .replace(/</g, "\\u003c")
    .replace(new RegExp("\u2028", "g"), "\\u2028")
    .replace(new RegExp("\u2029", "g"), "\\u2029");
}
