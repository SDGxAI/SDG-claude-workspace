import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { detectI18n, serializeI18n } from "@/lib/html/i18n";

/**
 * Kern der Seitenbearbeitung: Eine Seite ist EINE HTML-Datei. Jedes Element
 * bekommt eine stabile Kennung (data-sid), an der Kommentare, direkte
 * Änderungen und KI-Änderungen ansetzen. Reine Funktionen, überall nutzbar.
 */

export type Doc = cheerio.CheerioAPI;

const NO_SID = new Set([
  "script", "style", "noscript", "template", "br", "wbr", "source", "track",
  "param", "option", "optgroup", "base", "link", "meta", "title",
]);

export function load(html: string): Doc {
  return cheerio.load(html);
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag";
}

/** Elemente, die eine Kennung tragen (Inhalt von <svg> u. Ä. nicht). */
function stampable($: Doc, root?: cheerio.Cheerio<AnyNode>): Element[] {
  const out: Element[] = [];
  const walk = (node: AnyNode) => {
    if (!isElement(node)) return;
    const tag = node.tagName.toLowerCase();
    if (NO_SID.has(tag)) return;
    out.push(node);
    if (tag === "svg" || tag === "select") return;
    node.children.forEach(walk);
  };
  (root ?? $("body").children()).each((_, el) => walk(el));
  return out;
}

function signature($: Doc, el: Element): string | null {
  const node = $(el);
  const text = node.text().replace(/\s+/g, " ").trim().slice(0, 80);
  const src = (node.attr("src") ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
  if (!text && !src) return null; // leere Container sind nicht eindeutig
  return `${el.tagName}|${text}|${src}`;
}

/**
 * Vergibt Kennungen an alle Elemente ohne Kennung. Mit `previous` (HTML des
 * vorherigen Stands bzw. des ersetzten Abschnitts) werden Kennungen für
 * gleich gebliebene Elemente übernommen – so bleiben Kommentare an ihrer
 * Stelle, auch wenn Claude die Seite neu hochlädt oder die KI einen Abschnitt
 * neu schreibt.
 */
export function stampSids($: Doc, previous?: string): void {
  const used = new Set<string>();
  let max = 0;
  $("[data-sid]").each((_, el) => {
    const sid = $(el).attr("data-sid")!;
    if (used.has(sid)) $(el).removeAttr("data-sid"); // Duplikat (z. B. kopierter Block)
    else used.add(sid);
    const n = Number(sid.slice(1));
    if (Number.isFinite(n) && n > max) max = n;
  });

  const carry = new Map<string, string[]>();
  if (previous) {
    const $prev = cheerio.load(previous);
    $prev("[data-sid]").each((_, el) => {
      const sid = $prev(el).attr("data-sid")!;
      const n = Number(sid.slice(1));
      if (Number.isFinite(n) && n > max) max = n;
      if (used.has(sid) || !isElement(el)) return;
      const sig = signature($prev, el);
      if (!sig) return;
      const list = carry.get(sig) ?? [];
      list.push(sid);
      carry.set(sig, list);
    });
  }

  for (const el of stampable($)) {
    if ($(el).attr("data-sid")) continue;
    const sig = previous ? signature($, el) : null;
    const reused = sig ? carry.get(sig)?.shift() : undefined;
    const sid = reused && !used.has(reused) ? reused : `s${++max}`;
    used.add(sid);
    $(el).attr("data-sid", sid);
  }
}

/** Kennungen und Bearbeitungs-Reste entfernen (für Export, Claude und die KI). */
export function cleanHtml(html: string): string {
  return html
    .replace(/\s(?:data-sid|data-edit-id|data-wrap-link|data-sites-[a-z-]+)="[^"]*"/g, "")
    .replace(/\scontenteditable="[^"]*"/g, "");
}

/**
 * Fremdes HTML (Browser, KI) im Zusammenhang eines Elements einlesen – so
 * bleiben auch Tabellenzeilen u. Ä. heil – und entschärfen: keine Skripte,
 * keine Ereignis-Attribute, keine Bearbeitungs-Reste.
 */
function parseInto(context: cheerio.Cheerio<Element>, html: string): cheerio.Cheerio<Element> {
  const box = context.clone().empty();
  box.html(html);
  box.find("script").remove();
  box.find("*").each((_, node) => {
    if (!isElement(node)) return;
    for (const [name, value] of Object.entries(node.attribs)) {
      if (
        /^on/i.test(name) ||
        name === "contenteditable" ||
        name.startsWith("data-sites-") ||
        /^\s*javascript:/i.test(value)
      ) {
        delete node.attribs[name];
      }
    }
  });
  return box;
}

function bySid($: Doc, sid: string): cheerio.Cheerio<Element> {
  return $(`[data-sid="${sid.replace(/[^\w-]/g, "")}"]`).first() as cheerio.Cheerio<Element>;
}

/**
 * Den Abschnitt rund um ein Element bestimmen, den die KI zu sehen bekommt:
 * vom Element aus so weit nach oben, wie der Abschnitt handlich bleibt.
 */
export function pickFragment(
  $: Doc,
  sid: string,
  maxChars = 14000,
): { sid: string; html: string } | null {
  let el = bySid($, sid);
  if (!el.length) return null;
  for (;;) {
    const parent = el.parent();
    if (!parent.length || parent.is("body, html")) break;
    if ($.html(parent).length > maxChars) break;
    el = parent as cheerio.Cheerio<Element>;
  }
  const html = $.html(el);
  if (html.length > maxChars * 3) return null; // zu groß → ganze Seite
  return { sid: el.attr("data-sid")!, html };
}

/**
 * Ein Element durch neues HTML ersetzen (leer = löschen, mehrere Elemente
 * erlaubt). Liefert die neue Fassung samt Kennungen zurück.
 */
export function replaceFragment($: Doc, sid: string, newHtml: string): string | null {
  const el = bySid($, sid);
  if (!el.length) return null;
  const before = $.html(el);
  const known = new Set([...before.matchAll(/data-sid="([^"]+)"/g)].map((m) => m[1]));
  const box = parseInto(el.parent() as cheerio.Cheerio<Element>, newHtml);
  // Nur Kennungen behalten, die es an dieser Stelle schon gab.
  box.find("[data-sid]").each((_, node) => {
    if (!known.has($(node).attr("data-sid")!)) $(node).removeAttr("data-sid");
  });
  const roots = box.children();
  // Die Kennung der Stelle bleibt erhalten (Kommentare hängen daran).
  if (roots.length && !box.find(`[data-sid="${sid}"]`).length) {
    const tag = el.get(0)?.tagName;
    const same = roots.filter((_, r) => isElement(r) && r.tagName === tag).first();
    (same.length ? same : roots.first()).attr("data-sid", sid);
  }
  el.replaceWith(box.contents());
  stampSids($, before);
  syncI18n($, roots);
  return roots.toArray().map((r) => $.html(r)).join("");
}

/** Zusätzliche CSS-Regeln ans Ende der Seite hängen (gewinnen gegen ältere). */
export function appendCss($: Doc, css: string): void {
  const clean = css.replace(/<\/?style[^>]*>/gi, "").trim();
  if (!clean) return;
  let block = $("style[data-sites-css]").last();
  if (!block.length) {
    const parent: cheerio.Cheerio<AnyNode> = $("head").length ? $("head") : $.root();
    parent.append('<style data-sites-css=""></style>');
    block = $("style[data-sites-css]").last();
  }
  block.text(`${block.text()}\n${clean}\n`);
}

export interface Patch {
  sid: string;
  /** Neuer Inhalt (innerHTML) – z. B. nach dem Tippen eines Textes. */
  html?: string;
  /** Attribute setzen/entfernen (nur src, alt, href). */
  attrs?: Record<string, string | null>;
  /** Inline-Styles setzen/entfernen (nur border-radius, background-image). */
  style?: Record<string, string | null>;
}

const ATTRS = new Set(["src", "alt", "href"]);
const STYLES = new Set(["border-radius", "background-image"]);

function setStyles(el: cheerio.Cheerio<Element>, changes: Record<string, string | null>) {
  const map = new Map<string, string>();
  for (const part of (el.attr("style") ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  for (const [prop, value] of Object.entries(changes)) {
    if (!STYLES.has(prop)) continue;
    if (value === null || value === "") map.delete(prop);
    else map.set(prop, `${value.replace(/[;{}<>]/g, "").replace(/\s*!important/i, "")} !important`);
  }
  const style = [...map].map(([k, v]) => `${k}:${v}`).join(";");
  if (style) el.attr("style", style);
  else el.removeAttr("style");
}

/** Direkte Änderungen anwenden. Gibt die nicht gefundenen Kennungen zurück. */
export function applyPatches($: Doc, patches: Patch[]): string[] {
  const missing: string[] = [];
  for (const p of patches) {
    const el = bySid($, p.sid);
    if (!el.length) {
      missing.push(p.sid);
      continue;
    }
    if (typeof p.html === "string") {
      const before = $.html(el);
      el.empty().append(parseInto(el, p.html).contents());
      stampSids($, before);
      syncI18n($, el);
    }
    for (const [name, value] of Object.entries(p.attrs ?? {})) {
      if (!ATTRS.has(name) || /^\s*javascript:/i.test(value ?? "")) continue;
      if (value === null) el.removeAttr(name);
      else el.attr(name, value);
      if (name === "src") {
        // Neues Bild: Varianten des alten Bildes entfernen, sonst zeigt der
        // Browser weiter das alte.
        el.removeAttr("srcset").removeAttr("sizes").removeAttr("data-srcset").removeAttr("data-src");
        el.closest("picture").find("source").remove();
      }
    }
    if (p.style) setStyles(el, p.style);
  }
  return missing;
}

/**
 * HTML so, wie die KI es sieht: ohne Skripte und Kommentare, lange
 * eingebettete Daten als kurze Platzhalter (`restore` setzt sie wieder ein).
 */
export function aiView(html: string): { html: string; restore: (text: string) => string } {
  const assets: string[] = [];
  const slim = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s(?:data-edit-id|data-sites-[a-z-]+)="[^"]*"/g, "")
    .replace(/data:[^"')\s]{200,}/g, (m) => `__ASSET_${assets.push(m) - 1}__`);
  return {
    html: slim,
    restore: (text) => text.replace(/__ASSET_(\d+)__/g, (m, n) => assets[Number(n)] ?? m),
  };
}

/** Alle <style>-Blöcke der Seite (als Lese-Kontext für die KI). */
export function pageCss($: Doc, maxChars = 30000): string {
  const css = $("style").toArray().map((el) => $(el).text()).join("\n");
  return css.length > maxChars ? `${css.slice(0, maxChars)}\n/* … gekürzt … */` : css;
}

/**
 * Seiten mit eingebauter Übersetzungstabelle (data-i18n + Tabelle im Skript)
 * überschreiben beim Laden die Texte aus der Tabelle. Damit eine Änderung
 * nicht „verschwindet“, wird die Tabelle für die Sprache der Seite aus dem
 * geänderten Bereich nachgezogen.
 */
export function syncI18n($: Doc, scope: cheerio.Cheerio<AnyNode>): void {
  const nodes = scope.find("[data-i18n]").addBack("[data-i18n]");
  if (!nodes.length) return;
  const scripts = $("script").toArray();
  const texts = scripts.map((el) => $(el).text());
  const det = detectI18n(texts);
  if (!det) return;
  const pageLang = ($("html").attr("lang") ?? "").toLowerCase();
  const lang =
    det.langs.find((l) => l.toLowerCase() === pageLang) ??
    det.langs.find((l) => pageLang.startsWith(l.toLowerCase())) ??
    det.langs[0];
  let changed = false;
  nodes.each((_, el) => {
    const key = $(el).attr("data-i18n")!;
    const value = cleanHtml($(el).html() ?? "").trim();
    if (det.data[lang] && det.data[lang][key] !== value) {
      det.data[lang][key] = value;
      changed = true;
    }
  });
  if (!changed) return;
  const original = texts[det.range.scriptIndex];
  $(scripts[det.range.scriptIndex]).text(
    original.slice(0, det.range.start) + serializeI18n(det.data) + original.slice(det.range.end),
  );
}
