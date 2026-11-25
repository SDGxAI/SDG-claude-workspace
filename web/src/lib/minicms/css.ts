import postcss, { type AtRule, type ChildNode, type Root, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import type { Issues } from "./types";

/**
 * CSS einer Seite in die MiniCMS-Form bringen:
 * - Klassen mit dem Projekt-Präfix (`<token>__name`), IDs als data-Attribut
 * - html/body/:root zielen auf den Projekt-Wrapper (`.<token>`)
 * - reine Element-Selektoren wirken nur innerhalb des Projekts (:where(.<token>))
 * - Breakpoints als @container statt @media, vw als cqi
 * - keine eigenen Schriften (@font-face/@import fallen weg)
 * - Bilder über Custom Properties, die der Wrapper aus media.get_asset_link() setzt
 * - @keyframes-Namen mit Präfix
 */

const GENERIC_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif",
  "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial",
  "unset", "revert", "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica",
  "helvetica neue", "arial", "sans", "georgia", "times", "times new roman", "verdana", "tahoma",
  "trebuchet ms", "courier", "courier new", "menlo", "consolas", "monaco", "apple color emoji", "segoe ui emoji", "noto color emoji",
]);

export function prefixClass(token: string, name: string): string {
  return name.startsWith(`${token}__`) || name === token ? name : `${token}__${name}`;
}

export function idAttr(token: string): string {
  return `data-${token.replace(/_/g, "-")}-id`;
}

/**
 * Selektor umschreiben. `scopeTags`: reine Element-Selektoren in den Wrapper
 * einhängen (für CSS; in JavaScript-Selektoren nicht nötig).
 */
export function transformSelector(selector: string, token: string, scopeTags: boolean): string {
  const id = idAttr(token);
  const processor = selectorParser((root) => {
    root.walkClasses((node) => {
      node.value = prefixClass(token, node.value);
    });
    root.walkIds((node) => {
      node.replaceWith(selectorParser.attribute({ attribute: id, operator: "=", value: `"${node.value}"`, raws: {}, quoteMark: '"' } as never));
    });
    root.walkPseudos((node) => {
      if (node.value === ":root") node.replaceWith(selectorParser.className({ value: token }));
    });
    root.walkTags((node) => {
      const tag = node.value.toLowerCase();
      if (tag === "body") node.replaceWith(selectorParser.className({ value: token }));
      else if (tag === "html") {
        // `html .x` → `.x`, `html` → `.<token>`
        const next = node.next();
        const prev = node.prev();
        if (!prev && next && next.type === "combinator") {
          next.remove();
          node.remove();
        } else node.replaceWith(selectorParser.className({ value: token }));
      }
    });

    if (!scopeTags) return;
    root.each((sel) => {
      if (!sel.nodes.length) {
        sel.append(selectorParser.className({ value: token }));
        return;
      }
      // erstes zusammengesetztes Stück bestimmen
      const first: selectorParser.Node[] = [];
      for (const n of sel.nodes) {
        if (n.type === "combinator") break;
        first.push(n);
      }
      const startsAtRoot = first.some((n) => n.type === "class" && n.value === token);
      const hasAnchor = first.some((n) => n.type === "class" || n.type === "attribute" || n.type === "id");
      if (startsAtRoot || hasAnchor) return;
      // :where(.token) davor – ändert die Spezifität nicht
      const where = selectorParser.pseudo({ value: ":where" });
      const inner = selectorParser.selector({ value: "", nodes: [] } as never);
      inner.append(selectorParser.className({ value: token }));
      where.append(inner);
      sel.prepend(selectorParser.combinator({ value: " " }));
      sel.prepend(where);
    });
  });
  try {
    return processor.processSync(selector, { lossless: false });
  } catch {
    return selector;
  }
}

/** Media-Bedingung einordnen. */
function classifyMedia(params: string): "keep" | "container" | "unwrap" | "drop" {
  const p = params.toLowerCase();
  if (/prefers-reduced-motion/.test(p)) return "keep";
  if (/\bprint\b/.test(p) && !/\bscreen\b/.test(p)) return "drop";
  if (/prefers-color-scheme|orientation/.test(p)) return "drop";
  if (/(min-|max-)?(width|height)\s*[:<>=]/.test(p)) return "container";
  return "unwrap";
}

function containerParams(params: string): string {
  return params
    .replace(/^\s*(only\s+)?(screen|all)\s+and\s+/i, "")
    .replace(/\band\s+(only\s+)?(screen|all)\b/gi, "")
    .trim();
}

const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

export interface CssResult {
  css: string;
  fonts: string[];
}

export function transformCss(
  css: string,
  token: string,
  assetVar: (url: string) => string | null,
  issues: Issues,
): CssResult {
  let root: Root;
  try {
    root = postcss.parse(css);
  } catch (err) {
    issues.warn(`Das CSS enthält einen Fehler und wurde unverändert übernommen (${(err as Error).message.slice(0, 80)}).`);
    return { css, fonts: [] };
  }

  const keyframes = new Map<string, string>();
  const fonts = new Set<string>();
  let droppedFontFace = false;
  let droppedMedia = false;

  root.walkAtRules((at) => {
    const name = at.name.toLowerCase();
    if (name === "import" || name === "charset") {
      at.remove();
      return;
    }
    if (name === "font-face") {
      droppedFontFace = true;
      at.remove();
      return;
    }
    if (/^(-webkit-)?keyframes$/.test(name)) {
      const renamed = `${token}_${at.params.trim().replace(/[^\w-]/g, "")}`;
      keyframes.set(at.params.trim(), renamed);
      at.params = renamed;
      return;
    }
    if (name === "media") {
      const kind = classifyMedia(at.params);
      if (kind === "keep") return;
      if (kind === "drop") {
        droppedMedia = true;
        at.remove();
      } else if (kind === "unwrap") {
        at.replaceWith(at.nodes ?? []);
      } else {
        at.name = "container";
        at.params = containerParams(at.params);
        at.raws.afterName = " ";
      }
    }
  });

  root.walkRules((rule: Rule) => {
    const parent = rule.parent as AtRule | undefined;
    if (parent?.type === "atrule" && /keyframes$/i.test(parent.name)) return;
    rule.selector = transformSelector(rule.selector, token, true);
  });

  const kfNames = [...keyframes.keys()];
  const kfRe = kfNames.length
    ? new RegExp(`(^|[\\s,])(${kfNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[\\s,])`, "g")
    : null;

  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    let value = decl.value;
    if (/\d(\.\d+)?vw\b/.test(value)) value = value.replace(/(\d*\.?\d+)vw\b/g, "$1cqi");
    if (value.includes("url(")) {
      value = value.replace(URL_RE, (m, _q, url: string) => {
        if (url.startsWith("#")) return m;
        const v = assetVar(url.trim());
        return v ? `var(${v})` : m;
      });
    }
    if (kfRe && (prop === "animation" || prop === "animation-name")) {
      value = value.replace(kfRe, (_m, pre: string, n: string) => `${pre}${keyframes.get(n)}`);
    }
    if (prop === "font-family" || prop === "font") {
      const families = prop === "font" ? value.split(/\d(?:px|rem|em|%)?(?:\/[\d.]+\w*)?\s+/).pop() ?? "" : value;
      for (const f of families.split(",")) {
        const name = f.trim().replace(/^['"]|['"]$/g, "");
        if (name && !name.startsWith("var(") && !GENERIC_FONTS.has(name.toLowerCase())) fonts.add(name);
      }
    }
    decl.value = value;
  });

  // leere Regeln/At-Rules entfernen
  root.walk((node: ChildNode) => {
    if ((node.type === "rule" || node.type === "atrule") && "nodes" in node && node.nodes && node.nodes.length === 0) {
      if (node.type === "atrule" && !node.nodes) return;
      node.remove();
    }
  });

  if (droppedFontFace)
    issues.info("Eigene Schriftdateien (@font-face) wurden entfernt – das MiniCMS lädt Schriften selbst.");
  if (droppedMedia) issues.info("Druck- und Dark-Mode-Regeln (@media print / prefers-color-scheme) wurden entfernt.");

  return { css: root.toString().trim() + "\n", fonts: [...fonts] };
}
