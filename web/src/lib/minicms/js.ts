import * as acorn from "acorn";
import { idAttr, prefixClass, transformSelector } from "./css";
import type { Issues } from "./types";

/**
 * Skripte der Seite in ein content.js nach MiniCMS-Vorgabe verpacken:
 * - ES-Modul mit dem Bootstrap über import.meta.url (top_el_ref …)
 * - der Seitencode läuft in init(root) – nichts landet global
 * - `document`/`window` sind dort auf den Shadow-Root des Projekts umgelenkt
 *   (getElementById, querySelector, DOMContentLoaded …)
 * - Klassen-Namen und Selektoren im Code bekommen das Projekt-Präfix
 * - on…-Attribute aus dem Markup werden zu addEventListener
 */

export interface Handler {
  n: number;
  event: string;
  code: string;
}

type Node = acorn.Node & Record<string, unknown>;

const SELECTOR_METHODS = new Set(["querySelector", "querySelectorAll", "closest", "matches"]);
const CLASSLIST_METHODS = new Set(["add", "remove", "toggle", "contains", "replace"]);

function walk(node: unknown, visit: (n: Node, parent: Node | null) => void, parent: Node | null = null) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((c) => walk(c, visit, parent));
    return;
  }
  const n = node as Node;
  if (typeof n.type !== "string") return;
  visit(n, parent);
  for (const key of Object.keys(n)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    walk(n[key], visit, n);
  }
}

function prefixClassList(value: string, token: string): string {
  return value
    .split(/(\s+)/)
    .map((part) => (/^\s*$/.test(part) ? part : prefixClass(token, part)))
    .join("");
}

/** class="…" in HTML-Schnipseln (innerHTML-Bausteine) mit Präfix versehen. */
function prefixClassAttrs(html: string, token: string): string {
  return html.replace(/(\bclass\s*=\s*)(["'])([^"'$]*)\2/g, (_m, pre: string, q: string, v: string) => `${pre}${q}${prefixClassList(v, token)}${q}`);
}

function quote(value: string, original: string): string {
  const q = original.trim().startsWith("'") ? "'" : original.trim().startsWith("`") ? "`" : '"';
  if (q === "`") return "`" + value.replace(/[`\\]|\$\{/g, (m) => "\\" + m) + "`";
  return q + value.replace(new RegExp(`[${q}\\\\]`, "g"), (m) => "\\" + m).replace(/\n/g, "\\n") + q;
}

function staticString(node: Node): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && (node.expressions as Node[]).length === 0) {
    return ((node.quasis as Node[])[0].value as { cooked: string }).cooked;
  }
  return null;
}

function transformScript(code: string, token: string, issues: Issues, texts: Set<string>): string {
  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  } catch {
    try {
      ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
    } catch (err) {
      issues.warn(`Ein Skript der Seite hat einen Fehler und wurde unverändert übernommen (${(err as Error).message}).`);
      return code;
    }
  }

  const edits: { start: number; end: number; text: string }[] = [];
  const done = new Set<Node>();
  const replaceString = (node: Node, fn: (v: string) => string) => {
    const v = staticString(node);
    if (v === null || done.has(node)) return;
    done.add(node);
    const next = fn(v);
    if (next !== v) edits.push({ start: node.start, end: node.end, text: quote(next, code.slice(node.start, node.end)) });
  };

  walk(ast, (node) => {
    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
      issues.error("Ein Skript nutzt import/export – im MiniCMS sind keine externen Module erlaubt.");
    }
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      const args = node.arguments as Node[];
      if (callee.type !== "MemberExpression" || !args.length) return;
      const prop = (callee.property as Node).name as string | undefined;
      if (!prop) return;
      if (SELECTOR_METHODS.has(prop)) {
        if (staticString(args[0]) === null && args[0].type === "TemplateLiteral")
          issues.warn("Ein Skript baut Selektoren dynamisch zusammen – bitte im Shop testen, ob alles funktioniert.");
        replaceString(args[0], (v) => transformSelector(v, token, false));
      } else if (prop === "getElementsByClassName") {
        replaceString(args[0], (v) => prefixClassList(v, token));
      } else if (CLASSLIST_METHODS.has(prop) && ((callee.object as Node).property as Node | undefined)?.name === "classList") {
        const n = prop === "toggle" ? 1 : args.length;
        args.slice(0, n).forEach((a) => replaceString(a, (v) => prefixClassList(v, token)));
      } else if (prop === "setAttribute" && staticString(args[0]) === "class" && args[1]) {
        replaceString(args[1], (v) => prefixClassList(v, token));
      }
    }
    if (node.type === "AssignmentExpression") {
      const left = node.left as Node;
      if (left.type === "MemberExpression" && (left.property as Node).name === "className") {
        replaceString(node.right as Node, (v) => prefixClassList(v, token));
      }
    }
  });

  // HTML-Schnipsel mit class="…" und deutsche Texte im Code
  walk(ast, (node) => {
    if (done.has(node)) return;
    if (node.type === "TemplateLiteral") {
      for (const q of node.quasis as Node[]) {
        const raw = (q.value as { raw: string }).raw;
        const next = prefixClassAttrs(raw, token);
        if (next !== raw) edits.push({ start: q.start, end: q.end, text: next });
        if (/\p{L}{3,}\s+\p{L}{3,}/u.test(raw) && !/[<{;]/.test(raw)) texts.add(raw.trim().slice(0, 60));
      }
      return;
    }
    const v = node.type === "Literal" && typeof node.value === "string" ? (node.value as string) : null;
    if (v === null) return;
    if (/\bclass\s*=/.test(v)) replaceString(node, (s) => prefixClassAttrs(s, token));
    if (/\p{L}{3,}\s+\p{L}{3,}/u.test(v) && !/[<>{};=]/.test(v)) texts.add(v.trim().slice(0, 60));
  });

  edits.sort((a, b) => b.start - a.start);
  let out = code;
  let last = Infinity;
  for (const e of edits) {
    if (e.end > last) continue; // überlappend – sicherheitshalber auslassen
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
  }
  return out;
}

function indent(code: string): string {
  return code
    .trim()
    .split("\n")
    .map((l) => (l.trim() ? `\t${l}` : ""))
    .join("\n");
}

export function buildContentJs(opts: {
  name: string;
  token: string;
  scripts: string[];
  handlers: Handler[];
  onload: string[];
  issues: Issues;
}): string {
  const { token, issues } = opts;
  const id = idAttr(token);
  const onAttr = `data-${token.replace(/_/g, "-")}-on`;
  const texts = new Set<string>();
  const page = opts.scripts.map((s) => transformScript(s, token, issues, texts)).filter((s) => s.trim());
  const handlers = opts.handlers.map(
    (h) =>
      `on(${h.n}, '${h.event}', function (event) {\n${indent(transformScript(h.code, token, issues, texts))}\n})`,
  );
  if (texts.size) {
    const sample = [...texts].slice(0, 3).map((t) => `„${t}“`).join(", ");
    issues.warn(`Texte im Skript werden nicht mit übersetzt (${sample}${texts.size > 3 ? " …" : ""}). Bitte prüfen, ob sie auf der Seite sichtbar sind.`);
  }

  const body = [
    ...page.map((s, i) => `/* ---------- Skript ${i + 1} der Seite ---------- */\n${s.trim()}`),
    handlers.length ? `/* ---------- Ereignisse aus dem Markup ---------- */\n${handlers.join("\n")}` : "",
    opts.onload.length ? `/* ---------- beim Laden ---------- */\n${opts.onload.map((c) => transformScript(c, token, issues, texts)).join("\n")}` : "",
  ].filter(Boolean);

  return `/*
\t${opts.name} – content.js (erzeugt mit SDG Sites, MiniCMS-Export)

\tNach AGENTS.md:
\t  - ES-Modul, nichts landet auf window/document/globalThis
\t  - jeder DOM-Zugriff laeuft ueber den per URL-Param uebergebenen Shadow-Root
\t  - init() kann mehrfach mit verschiedenen Instanzen laufen
\t  - keine externen Imports

\tDer Seitencode laeuft in init(root). Dort zeigen \`document\` und \`window\`
\tauf Huellen, die alles auf dieses Projekt begrenzen: getElementById sucht
\tdas Element mit ${id}="…", querySelector nur im Projekt, und
\tDOMContentLoaded/load feuern sofort, weil die Seite dann schon steht.
*/

/* export:bootstrap:start */
const import_params = new URL(import.meta.url).searchParams
const top_el_ref = import_params.get('top_el_ref')
const top_el_ref_shadow_inner_dst = import_params.get('top_el_ref_shadow_inner_dst')

function wait_for_ready() {
\tif (top_el_ref === null || top_el_ref_shadow_inner_dst === null) {
\t\treturn
\t}

\tconst top_el = globalThis.document?.getElementById(top_el_ref)?.shadowRoot?.getElementById(top_el_ref_shadow_inner_dst)
\tif (top_el === null || typeof top_el === 'undefined') {
\t\t// Der Shadow-Root haengt eventuell noch nicht dran
\t\tsetTimeout(wait_for_ready, 60)
\t\treturn
\t}

\tinit(top_el)
}
/* export:bootstrap:end */

function scoped_document(root) {
\tconst real = globalThis.document
\tconst top = root.querySelector('.${token}') || root
\tconst overrides = {
\t\tgetElementById: (value) => root.querySelector('[${id}="' + String(value).replace(/["\\\\]/g, '\\\\$&') + '"]'),
\t\tquerySelector: (selector) => root.querySelector(selector),
\t\tquerySelectorAll: (selector) => root.querySelectorAll(selector),
\t\tgetElementsByClassName: (names) => top.getElementsByClassName(names),
\t\tgetElementsByTagName: (tag) => top.getElementsByTagName(tag),
\t\taddEventListener: (type, listener, options) => {
\t\t\tif (type === 'DOMContentLoaded' || type === 'readystatechange') {
\t\t\t\tsetTimeout(() => (typeof listener === 'function' ? listener.call(top, new Event(type)) : listener.handleEvent(new Event(type))), 0)
\t\t\t\treturn
\t\t\t}
\t\t\treal.addEventListener(type, listener, options)
\t\t},
\t\tbody: top,
\t\tdocumentElement: top,
\t}
\treturn new Proxy(real, {
\t\tget(target, prop) {
\t\t\tif (prop in overrides) return overrides[prop]
\t\t\tconst value = Reflect.get(target, prop)
\t\t\treturn typeof value === 'function' ? value.bind(target) : value
\t\t},
\t})
}

function scoped_window(doc) {
\tconst real = globalThis.window
\tconst local = {}
\treturn new Proxy(real, {
\t\tget(target, prop) {
\t\t\tif (prop === 'document') return doc
\t\t\tif (prop in local) return local[prop]
\t\t\tif (prop === 'addEventListener') {
\t\t\t\treturn (type, listener, options) => {
\t\t\t\t\tif (type === 'DOMContentLoaded' || (type === 'load' && target.document.readyState === 'complete')) {
\t\t\t\t\t\tsetTimeout(() => (typeof listener === 'function' ? listener(new Event(type)) : listener.handleEvent(new Event(type))), 0)
\t\t\t\t\t\treturn
\t\t\t\t\t}
\t\t\t\t\ttarget.addEventListener(type, listener, options)
\t\t\t\t}
\t\t\t}
\t\t\tconst value = Reflect.get(target, prop)
\t\t\treturn typeof value === 'function' ? value.bind(target) : value
\t\t},
\t\t// Zuweisungen wie window.x = … bleiben im Projekt statt global
\t\tset(_target, prop, value) {
\t\t\tlocal[prop] = value
\t\t\treturn true
\t\t},
\t})
}

function init(root) {
\tconst document = scoped_document(root)
\tconst window = scoped_window(document)
\tconst on = (n, type, listener) => {
\t\troot.querySelectorAll('[${onAttr}-' + type + '="' + n + '"]').forEach((el) => el.addEventListener(type, listener))
\t}
\tvoid window
\tvoid on

\t// Sprungmarken (#…) innerhalb des Projekts
\troot.addEventListener('click', (event) => {
\t\tconst link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null
\t\tif (link === null) return
\t\tconst target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)))
\t\tif (target === null) return
\t\tevent.preventDefault()
\t\ttarget.scrollIntoView({ behavior: 'smooth', block: 'start' })
\t})

${body.map(indent).join("\n\n")}
}

wait_for_ready()
`;
}
