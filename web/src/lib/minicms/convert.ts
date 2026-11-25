import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { idAttr, prefixClass, transformCss } from "./css";
import { buildContentJs, type Handler } from "./js";
import type { Issues, TextUnit } from "./types";

/**
 * Wandelt eine SDG-Sites-Seite (eine HTML-Datei) in ein MiniCMS-Projekt um:
 * content.twig, content.css, content.js und die deutschen Texte als
 * Übersetzungs-Einheiten. Reine Funktion – Bilder holen und Übersetzen
 * passiert außerhalb (siehe build.ts).
 *
 * Bilder stehen in der Vorlage zunächst als Platzhalter `__SDG_ASSET_<n>__`;
 * sie werden ersetzt, sobald feststeht, unter welchem Dateinamen das Bild in
 * public/ liegt.
 */

const SKIP = new Set(["script", "style", "link", "meta", "title", "base", "noscript", "template", "head"]);
const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "source", "track", "wbr"]);
const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q",
  "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "del", "ins", "font", "label",
]);
const TEXT_ATTRS = new Set(["alt", "title", "placeholder", "aria-label"]);
const SECTION_TAGS = new Set(["section", "header", "footer", "article", "aside", "nav"]);
const GENERIC_CLASSES = new Set(["wrap", "wrapper", "container", "inner", "section", "row", "col", "content", "block", "box"]);
const RESERVED_KEYS = new Set(["title", "description", "seo_keywords", "banner_logo"]);
const LANG_CODES = "de|en|fr|nl|it|es|pl|cz|cs|dk|da|se|sv|no|fi|pt|hu|tr";
const LANG_SWITCH_RE = new RegExp(`^(${LANG_CODES})(\\s*[|/·•,-]?\\s*(${LANG_CODES}))+$`, "i");
const BUY_RE = /\b(kaufen|jetzt bestellen|bestellen|zum shop|im shop|shop now|buy|in den warenkorb|warenkorb|acheter|commander|zum produkt)\b/i;
export const PLACEHOLDER_RE = /placehold|placeholder|platzhalter|dummyimage|picsum\.photos|via\.placeholder|lorempixel|placekitten/i;

/** Twig-String in einfachen Anführungszeichen. */
export function tw(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Text so ausgeben, dass Twig ihn nicht als eigenen Code liest. */
function escapeTwig(text: string): string {
  return text.replace(/\{[{%#]/g, (m) => `{{ '${m}' }}`);
}

function escText(text: string): string {
  return escapeTwig(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;"));
}

function escAttr(text: string): string {
  return escapeTwig(text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"));
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text);
}

function sanitizeName(raw: string): string {
  const s = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(s) ? s : s ? `s_${s}` : "";
}

/** Artikelnummer (SKU) eines Links – aus data-sku o. Ä. oder der Shop-Adresse. */
export function findSku(el: Element): string | null {
  for (const attr of ["data-sku", "data-artikelnummer", "data-article-number", "data-product-sku"]) {
    const v = el.attribs[attr]?.trim();
    if (v && /^[\w-]{3,20}$/.test(v)) return v;
  }
  const href = el.attribs.href ?? "";
  if (!/^https?:\/\//i.test(href)) return null;
  const m = /(?:^|[^\d])(\d{9})(?=[^\d]|$)/.exec(href.split("?")[0]);
  return m ? m[1] : null;
}

type Value = { literal: string } | { expr: string };

interface Slot {
  kind: "text" | "attrText" | "attr" | "sku";
  value: string; // Text bzw. Twig-Ausdruck bzw. Artikelnummer
  literal?: string; // für attr: unveränderter Wert
}

interface LoopRec {
  slots: Slot[];
  units: number[][];
  cur: number[] | null;
  links: number;
  id: number;
}

interface Section {
  name: string;
  n: number;
  loops: number;
}

interface Ctx {
  sec: Section;
  unit: { key: string; de: string }[] | null;
  loop: LoopRec | null;
  svg: boolean;
  top: boolean; // direkt unter body/Wrapper
}

export interface ConvertResult {
  twig: string;
  css: string;
  js: string;
  units: TextUnit[];
  sourceLang: string;
  meta: { title: string; description: string; keywords: string };
  skus: { sku: string; label: string }[];
  fonts: string[];
  /** CSS-Bilder: Custom Property → Asset-Index */
  cssAssets: { variable: string; index: number }[];
}

/** Alle Bild-/Video-Adressen der Seite in fester Reihenfolge. */
export function collectAssetUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const add = (u: string | undefined) => {
    const v = u?.trim();
    if (!v || v.startsWith("#") || /^(about|javascript|mailto|tel):/i.test(v)) return;
    if (!urls.includes(v)) urls.push(v);
  };
  const fromCss = (css: string) => {
    for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) add(m[2]);
  };
  $("style").each((_, el) => fromCss($(el).text()));
  $("body *").each((_, el) => {
    if (!isElement(el)) return;
    const a = el.attribs;
    for (const name of ["src", "poster", "data-src", "data-bg"]) add(a[name]);
    if (el.tagName === "image") add(a.href ?? a["xlink:href"]);
    for (const name of ["srcset", "data-srcset"]) {
      if (a[name]) a[name].split(/,\s+/).forEach((part) => add(part.trim().split(/\s+/)[0]));
    }
    if (a.style) fromCss(a.style);
  });
  return urls.filter((u) => !/\.(js|css|woff2?|ttf|otf|eot)(\?|#|$)/i.test(u));
}

export function convertPage(opts: { html: string; name: string; token: string; issues: Issues }): ConvertResult {
  return new Converter(opts.html, opts.name, opts.token, opts.issues).run();
}

class Converter {
  private $: cheerio.CheerioAPI;
  private assetIndex: Map<string, number>;
  private units: TextUnit[] = [];
  private sections = new Set<string>();
  private handlers: Handler[] = [];
  private onload: string[] = [];
  private consumed = new Set<Element>();
  private newsletters = new Map<Element, { head: Element[]; desc: Element[] }>();
  private skus = new Map<string, string>();
  private handlerN = 0;
  private linkN = 0;
  private loopN = 0;
  private cssAssets: { variable: string; index: number }[] = [];
  private tokenDash: string;

  constructor(
    private html: string,
    private name: string,
    private token: string,
    private issues: Issues,
  ) {
    this.$ = cheerio.load(html);
    this.assetIndex = new Map(collectAssetUrls(html).map((u, i) => [u, i]));
    this.tokenDash = token.replace(/_/g, "-");
  }

  private asset(url: string): string | null {
    const i = this.assetIndex.get(url.trim());
    if (i === undefined) return null;
    if (PLACEHOLDER_RE.test(url)) this.issues.error(`Platzhalterbild auf der Seite (${url.slice(0, 60)}) – bitte durch das finale Bild ersetzen.`);
    return `__SDG_ASSET_${i}__`;
  }

  run(): ConvertResult {
    const $ = this.$;
    const sourceLang = ($("html").attr("lang") || "de").slice(0, 2).toLowerCase();
    if (sourceLang !== "de")
      this.issues.warn(`Die Seite ist als „${sourceLang}“ markiert – Texte gelten als ${sourceLang.toUpperCase()}, die anderen Sprachen werden übersetzt.`);

    const meta = {
      title: $("title").first().text().trim(),
      description: $('meta[name="description"]').attr("content")?.trim() ?? "",
      keywords: $('meta[name="keywords"]').attr("content")?.trim() ?? "",
    };

    // CSS aus allen <style>-Blöcken; externe Stylesheets (z. B. Google Fonts) fallen weg
    const styles = $("style").toArray().map((el) => $(el).text());
    if ($('link[rel~="stylesheet"]').length)
      this.issues.info("Externe Stylesheets (z. B. Google Fonts) wurden entfernt – im MiniCMS sind keine CDNs erlaubt.");
    const cssAssetVar = new Map<string, string>();
    const { css, fonts } = transformCss(
      styles.join("\n\n"),
      this.token,
      (url) => {
        const ref = this.asset(url);
        if (!ref) return null;
        const index = Number(ref.match(/\d+/)![0]);
        let v = cssAssetVar.get(url);
        if (!v) {
          v = `--${this.tokenDash}-bild-${cssAssetVar.size + 1}`;
          cssAssetVar.set(url, v);
          this.cssAssets.push({ variable: v, index });
        }
        return v;
      },
      this.issues,
    );

    // Skripte
    const scripts: string[] = [];
    $("script").each((_, el) => {
      const node = $(el);
      const type = (node.attr("type") ?? "").toLowerCase();
      if (node.attr("src")) {
        this.issues.error(`Externes Skript entfernt (${node.attr("src")!.slice(0, 60)}) – im MiniCMS sind keine fremden Skripte erlaubt.`);
        return;
      }
      if (/ld\+json/.test(type)) {
        this.issues.info("Strukturierte Daten (JSON-LD) wurden entfernt – das MiniCMS liefert Titel und Beschreibung über meta.json.");
        return;
      }
      if (type && !/javascript|module|^text\/babel$/.test(type)) return;
      const code = node.text();
      if (code.trim()) scripts.push(code);
    });

    const body = $("body").first();
    const bodyOnload = body.attr("onload");
    if (bodyOnload) this.onload.push(bodyOnload);

    this.findNewsletters();

    const root: Section = { name: "page", n: 0, loops: 0 };
    const ctx: Ctx = { sec: root, unit: null, loop: null, svg: false, top: true };
    // Ein einzelner Wrapper direkt unter body zählt nicht als Abschnittsebene
    const kids = body.contents().toArray().filter((n) => !(n.type === "text" && !(n as unknown as { data: string }).data.trim()) && n.type !== "comment");
    const single = kids.length === 1 && isElement(kids[0]) && ["div", "main"].includes(kids[0].tagName) ? kids[0] : null;
    let inner: string;
    if (single) {
      const attrs = this.attrs(single, { ...ctx, top: false }, single.tagName);
      inner = `<${single.tagName}${attrs}>${this.children(single, ctx)}</${single.tagName}>`;
    } else {
      inner = this.children(body[0] as Element, ctx);
    }

    const bodyClasses = (body.attr("class") ?? "").split(/\s+/).filter(Boolean).map((c) => prefixClass(this.token, c));
    const style = this.cssAssets.length
      ? ` style="${this.cssAssets.map((a) => `${a.variable}: url('{{ media.get_asset_link('__SDG_ASSET_${a.index}__') }}')`).join("; ")}"`
      : "";

    const skuList = [...this.skus].map(([sku, label]) => ({ sku, label }));
    const twig = [
      "{#",
      `\t${this.name} – content.twig (erzeugt mit SDG Sites, MiniCMS-Export)`,
      "",
      "\tNach AGENTS.md:",
      "\t  - alle Texte ueber translations/{de,en,fr}.json",
      "\t  - alle Medien ueber media.get_asset_link('public/...'), keine data:-URIs",
      "\t  - Produktlinks nur ueber product.get_url(sku): ohne Link aus der Shop-API",
      "\t    entfaellt der Button (kein Fallback)",
      `\t  - keine IDs im Markup (mehrfach einbettbar), JS haengt an data-${this.tokenDash}-*`,
      "\t  - Newsletter ueber @shared/newsletter.twig",
      "\t  - Kopf-/Fusszeile nur standalone; keine Fremd-Skripte, kein Tracking",
      "#}",
      "",
      `<div class="${[this.token, ...bodyClasses].join(" ")}"${style}>`,
      inner.replace(/\n{3,}/g, "\n\n").trim(),
      "</div>",
      "",
    ].join("\n");

    const js = buildContentJs({ name: this.name, token: this.token, scripts, handlers: this.handlers, onload: this.onload, issues: this.issues });

    for (const u of this.units) {
      for (const t of u.de) {
        if (/lorem ipsum/i.test(t)) this.issues.error("Blindtext („Lorem ipsum“) auf der Seite – bitte durch den finalen Text ersetzen.");
        else if (/platzhalter|placeholder|blindtext/i.test(t) || (t.length < 40 && /\bfolgt\b|coming soon|\btbd\b|\bxxx+\b/i.test(t)))
          this.issues.error(`Platzhalter auf der Seite: „${t}“ – bitte durch den finalen Inhalt ersetzen.`);
      }
    }
    for (const m of this.html.matchAll(/<!--([\s\S]*?)-->/g)) {
      if (/\b(todo|fixme)\b/i.test(m[1])) this.issues.warn(`Offener Hinweis im Code: „${m[1].trim().replace(/\s+/g, " ").slice(0, 90)}“`);
    }
    if ($("a[href^='file:']").length) this.issues.error("Es gibt Links auf lokale Dateien (file://) – bitte durch echte Adressen oder Sprungmarken (#…) ersetzen.");

    return { twig, css, js, units: this.units, sourceLang, meta, skus: skuList, fonts, cssAssets: this.cssAssets };
  }

  // ---------- Newsletter ----------

  private findNewsletters() {
    const $ = this.$;
    // Anmeldefelder: <form> mit E-Mail-Feld, sonst der kleinste Block um das
    // E-Mail-Feld, der auch den Absende-Button enthält
    const containers = new Set<Element>();
    $("input").each((_, input) => {
      const a = (input as Element).attribs;
      if (a.type !== "email" && !/mail/i.test(a.name ?? "") && !/mail/i.test(a.id ?? "")) return;
      const form = $(input).closest("form");
      if (form.length) {
        containers.add(form[0] as Element);
        return;
      }
      let p = $(input).parent();
      while (p.length && !p.is("body")) {
        if (p.find('button, input[type="submit"], input[type="button"], a[class*="btn"]').length) {
          containers.add(p[0] as Element);
          return;
        }
        p = p.parent();
      }
    });

    for (const form of containers) {
      const f = $(form);
      // Überschrift und Beschreibung davor (im selben Abschnitt) wandern in die Blöcke
      let head: Element[] = [];
      let desc: Element[] = [];
      let scope: cheerio.Cheerio<AnyNode> = f;
      for (let depth = 0; depth < 3 && !head.length; depth++) {
        const before = scope.prevAll().toArray().reverse() as Element[];
        const h = before.filter((el) => /^h[1-4]$/.test(el.tagName));
        if (h.length) {
          head = [h[h.length - 1]];
          const after = before.slice(before.indexOf(h[h.length - 1]) + 1);
          desc = after.filter((el) => el.tagName === "p").slice(0, 2);
          // Dachzeile direkt vor der Überschrift
          const idx = before.indexOf(h[h.length - 1]);
          const kicker = idx > 0 ? before[idx - 1] : null;
          if (kicker && ["span", "p", "div"].includes(kicker.tagName) && $(kicker).text().trim().length < 60 && !$(kicker).find("img,form").length)
            head = [kicker, ...head];
        }
        scope = scope.parent();
        if (!scope.length || scope.is("body")) break;
      }
      head.forEach((el) => this.consumed.add(el));
      desc.forEach((el) => this.consumed.add(el));
      // Reste der eigenen Anmeldung: Fehlermeldung, Einwilligungstext, Danke-Box
      for (const next of f.nextAll().toArray() as Element[]) {
        const n = $(next);
        const t = n.text().trim();
        if (next.attribs.role === "alert" || (!t && !n.find("img").length) || /datenschutz|einwillig|abmelden|privacy|newsletter/i.test(t))
          this.consumed.add(next);
      }
      const area = f.closest("section").length ? f.closest("section") : f.parent().parent();
      area.find("[class], [id]").each((_, el) => {
        const e = el as Element;
        if (/success|erfolg|danke|thank/i.test(`${e.attribs.class ?? ""} ${e.attribs.id ?? ""}`) && !$(e).find(form).length)
          this.consumed.add(e);
      });
      this.newsletters.set(form, { head, desc });
    }
  }

  private newsletter(form: Element, ctx: Ctx): string {
    const parts = this.newsletters.get(form)!;
    const render = (els: Element[]) => {
      const out = els.map((el) => {
        this.consumed.delete(el);
        const html = this.el(el, ctx);
        this.consumed.add(el);
        return html;
      });
      return out.join("\n");
    };
    this.issues.info("Das Anmeldeformular wurde durch den Newsletter-Baustein der D2S ersetzt (@shared/newsletter.twig, inkl. Captcha und Double-Opt-In).");
    return [
      "{% embed '@shared/newsletter.twig' %}",
      `{% block newsletter_headline %}${render(parts.head)}{% endblock %}`,
      `{% block newsletter_description %}${render(parts.desc)}{% endblock %}`,
      "{% endembed %}",
    ].join("\n");
  }

  // ---------- Bausteine ----------

  private newKey(sec: Section): string {
    return `${sec.name}.t${++sec.n}`;
  }

  private section(el: Element, ctx: Ctx): Section {
    if (ctx.loop || ctx.svg) return ctx.sec;
    if (!ctx.top && !SECTION_TAGS.has(el.tagName)) return ctx.sec;
    const classes = (el.attribs.class ?? "").split(/\s+/).filter((c) => c && !GENERIC_CLASSES.has(c));
    let base = sanitizeName(classes[0] ?? el.attribs.id ?? el.tagName) || "abschnitt";
    if (RESERVED_KEYS.has(base) || /^[tli]\d+$/.test(base)) base = `${base}_s`;
    let name = base;
    for (let i = 2; this.sections.has(name); i++) name = `${base}_${i}`;
    this.sections.add(name);
    return { name, n: 0, loops: 0 };
  }

  private textSlot(ctx: Ctx, de: string, attr: boolean): string {
    if (ctx.loop) {
      const i = ctx.loop.slots.push({ kind: attr ? "attrText" : "text", value: de }) - 1;
      if (ctx.loop.cur && !attr) ctx.loop.cur.push(i);
      else ctx.loop.units.push([i]);
      return `\u0001${i}\u0002`;
    }
    const key = this.newKey(ctx.sec);
    if (ctx.unit && !attr) ctx.unit.push({ key, de });
    else this.units.push({ keys: [key], de: [de] });
    return attr ? `{{ ${tw(key)} | trans | escape('html_attr') }}` : `{{ ${tw(key)} | trans }}`;
  }

  private attrSlot(ctx: Ctx, v: Value): string {
    if (ctx.loop) {
      const slot: Slot = "expr" in v ? { kind: "attr", value: v.expr } : { kind: "attr", value: tw(v.literal), literal: v.literal };
      const i = ctx.loop.slots.push(slot) - 1;
      return `\u0001${i}\u0002`;
    }
    return "expr" in v ? `{{ ${v.expr} }}` : escAttr(v.literal);
  }

  private text(raw: string, ctx: Ctx): string {
    const collapsed = raw.replace(/[ \t\r\n\f]+/g, " ");
    const trimmed = collapsed.trim();
    if (!trimmed) return /\n/.test(raw) ? "\n" : collapsed;
    const lead = collapsed.startsWith(" ") ? " " : "";
    const trail = collapsed.endsWith(" ") ? " " : "";
    if (ctx.svg || !hasLetters(trimmed)) return lead + escText(trimmed) + trail;
    return lead + this.textSlot(ctx, trimmed, false) + trail;
  }

  /** Wert mit Bild-Adressen (style, srcset) als Twig-Ausdruck. */
  private valueWithAssets(value: string, kind: "css" | "srcset"): Value {
    const parts: { text?: string; asset?: string }[] = [];
    const re = kind === "css" ? /url\(\s*(['"]?)([^'")]+)\1\s*\)/g : /(^|,\s*)([^\s,]+)/g;
    let last = 0;
    for (const m of value.matchAll(re)) {
      const ref = this.asset(m[2]);
      if (!ref) continue;
      const start = m.index! + (kind === "css" ? 0 : m[1].length);
      const end = kind === "css" ? m.index! + m[0].length : start + m[2].length;
      parts.push({ text: value.slice(last, start) });
      if (kind === "css") parts.push({ text: "url('" }, { asset: ref }, { text: "')" });
      else parts.push({ asset: ref });
      last = end;
    }
    parts.push({ text: value.slice(last) });
    const vw = (t: string) => (kind === "css" ? t.replace(/(\d*\.?\d+)vw\b/g, "$1cqi") : t);
    if (!parts.some((p) => p.asset)) return { literal: vw(value) };
    return {
      expr: parts
        .filter((p) => p.asset || p.text)
        .map((p) => (p.asset ? `media.get_asset_link(${tw(p.asset)})` : tw(vw(p.text!))))
        .join(" ~ "),
    };
  }

  private attrs(el: Element, ctx: Ctx, tag: string, link?: { variable: string }): string {
    const out: string[] = [];
    for (const [name, raw] of Object.entries(el.attribs)) {
      const value = raw ?? "";
      if (/^data-(sid|i18n|edit|sites)/.test(name) || name === "contenteditable") continue;
      if (name === "class") {
        const cls = value.split(/\s+/).filter(Boolean).map((c) => prefixClass(this.token, c)).join(" ");
        if (cls) out.push(`class="${cls}"`);
        continue;
      }
      if (name === "id") {
        if (ctx.svg) out.push(`id="${escAttr(value)}"`);
        else out.push(`${idAttr(this.token)}="${this.attrSlot(ctx, { literal: value })}"`);
        continue;
      }
      if (name === "for" && tag === "label") continue;
      if (/^on[a-z]+$/.test(name)) {
        const n = ++this.handlerN;
        this.handlers.push({ n, event: name.slice(2), code: value });
        out.push(`data-${this.tokenDash}-on-${name.slice(2)}="${this.attrSlot(ctx, { literal: String(n) })}"`);
        continue;
      }
      if (name === "href" && tag === "a") {
        if (link) {
          out.push(`href="{{ ${link.variable} | escape('html_attr') }}"`);
          continue;
        }
        if (/^\s*javascript:/i.test(value)) {
          const n = ++this.handlerN;
          this.handlers.push({ n, event: "click", code: `event.preventDefault();\n${value.replace(/^\s*javascript:/i, "")}` });
          out.push(`href="#" data-${this.tokenDash}-on-click="${this.attrSlot(ctx, { literal: String(n) })}"`);
          continue;
        }
      }
      if (TEXT_ATTRS.has(name) || (name === "value" && tag === "input" && /^(submit|button)$/i.test(el.attribs.type ?? ""))) {
        if (hasLetters(value) && !ctx.svg) {
          out.push(`${name}="${this.textSlot(ctx, value.trim().replace(/\s+/g, " "), true)}"`);
          continue;
        }
      }
      if (["src", "poster", "data-src", "data-bg"].includes(name) || (name === "href" && tag === "image") || name === "xlink:href") {
        const ref = this.asset(value);
        if (ref) {
          out.push(`${name}="${this.attrSlot(ctx, { expr: `media.get_asset_link(${tw(ref)})` })}"`);
          continue;
        }
        if (/^data:/i.test(value) || /supabase\.co\/storage/i.test(value))
          this.issues.error("Ein Bild konnte nicht als Datei übernommen werden.");
      }
      if (name === "srcset" || name === "data-srcset") {
        out.push(`${name}="${this.attrSlot(ctx, this.valueWithAssets(value, "srcset"))}"`);
        continue;
      }
      if (name === "style") {
        out.push(`style="${this.attrSlot(ctx, this.valueWithAssets(value, "css"))}"`);
        continue;
      }
      out.push(value === "" ? name : `${name}="${this.attrSlot(ctx, { literal: value })}"`);
    }
    return out.length ? " " + out.join(" ") : "";
  }

  private isTextBlock(el: Element): boolean {
    let text = false;
    const ok = (node: AnyNode): boolean => {
      if (node.type === "text") {
        if ((node as unknown as { data: string }).data.trim()) text = true;
        return true;
      }
      if (node.type === "comment") return true;
      if (!isElement(node)) return false;
      if (!INLINE.has(node.tagName)) return false;
      return node.children.every(ok);
    };
    return el.children.every(ok) && text;
  }

  private isLangSwitcher(el: Element): boolean {
    if (el.tagName === "body" || (SECTION_TAGS.has(el.tagName) && el.tagName !== "nav")) return false;
    const node = this.$(el);
    if (node.find("img, picture, svg, video, h1, h2, h3, p").length) return false;
    const text = node.text().replace(/\s+/g, " ").trim();
    return text.length <= 30 && LANG_SWITCH_RE.test(text) && node.find("a, button").length >= 2;
  }

  private signature(node: AnyNode): string {
    if (node.type === "text") return (node as unknown as { data: string }).data.trim() ? "T" : "";
    if (!isElement(node)) return "";
    const cls = (node.attribs.class ?? "").split(/\s+/).filter(Boolean).sort().join(".");
    const attrs = Object.keys(node.attribs).filter((a) => a !== "class" && !a.startsWith("data-sid")).sort().join(",");
    return `<${node.tagName}.${cls}[${attrs}]${node.children.map((c) => this.signature(c)).join("")}>`;
  }

  // ---------- Serialisieren ----------

  private children(parent: Element, ctx: Ctx): string {
    const nodes = parent.children;
    const out: string[] = [];
    const canLoop = !ctx.loop && !ctx.unit && !ctx.svg;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (canLoop && isElement(node)) {
        // gleich aufgebaute Geschwister (≥ 3) → for-Schleife
        const sig = this.signature(node);
        const group: Element[] = [node];
        let j = i + 1;
        for (; j < nodes.length; j++) {
          const n = nodes[j];
          if (n.type === "comment" || (n.type === "text" && !(n as unknown as { data: string }).data.trim())) continue;
          if (isElement(n) && this.signature(n) === sig) group.push(n);
          else break;
        }
        if (group.length >= 3 && /T|<img|<picture|<video/.test(sig) && !this.consumed.has(node) && !this.newsletters.has(node)) {
          const looped = this.loop(group, ctx);
          if (looped) {
            out.push(looped);
            // bis zum letzten Element der Gruppe springen
            i = nodes.indexOf(group[group.length - 1]);
            continue;
          }
        }
      }
      out.push(this.node(node, ctx));
    }
    return out.join("");
  }

  private node(node: AnyNode, ctx: Ctx): string {
    if (node.type === "text") return this.text((node as unknown as { data: string }).data, ctx);
    if (isElement(node)) return this.el(node, ctx);
    return "";
  }

  private el(el: Element, parentCtx: Ctx): string {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || this.consumed.has(el)) return "";
    if (["iframe", "object", "embed"].includes(tag)) {
      this.issues.error("Eingebettete fremde Inhalte (z. B. YouTube, Karten) wurden entfernt – im MiniCMS nicht erlaubt. Videos bitte als MP4 einbauen.");
      return "";
    }
    if (this.newsletters.has(el)) return this.newsletter(el, parentCtx);
    if (tag === "form") this.issues.warn("Die Seite enthält ein Formular, das im MiniCMS nicht abgeschickt werden kann – bitte mit der D2S klären.");
    if (!parentCtx.svg && this.isLangSwitcher(el)) {
      this.issues.info("Die Sprachauswahl wurde entfernt – die Sprache wählt das MiniCMS.");
      return "";
    }

    const svg = parentCtx.svg || tag === "svg";
    const sec = this.section(el, parentCtx);
    const ctx: Ctx = { ...parentCtx, sec, svg, top: false };

    // Produktlink über die Shop-API
    let link: { variable: string; button: boolean } | undefined;
    if (tag === "a" && !svg) {
      const sku = findSku(el);
      const text = this.$(el).text().replace(/\s+/g, " ").trim();
      if (sku) {
        if (!this.skus.has(sku)) this.skus.set(sku, text.slice(0, 60) || (el.attribs.href ?? ""));
        const variable = ctx.loop ? `_l${ctx.loop.id}_${ctx.loop.links++}` : `_u${++this.linkN}`;
        const skuExpr = ctx.loop ? `\u0001${ctx.loop.slots.push({ kind: "sku", value: tw(sku), literal: sku }) - 1}\u0002` : tw(sku);
        const cls = el.attribs.class ?? "";
        link = { variable, button: /btn|button|cta/i.test(cls) || el.attribs.role === "button" || BUY_RE.test(text) };
        const attrs = this.attrs(el, ctx, tag, link);
        const inner = this.inner(el, ctx);
        const set = `{% set ${variable} = product.get_url(${skuExpr}) %}`;
        return link.button
          ? `${set}{% if ${variable} %}<a${attrs}>${inner}</a>{% endif %}`
          : `${set}{% if ${variable} %}<a${attrs}>{% endif %}${inner}{% if ${variable} %}</a>{% endif %}`;
      }
      const href = el.attribs.href ?? "";
      if (BUY_RE.test(text) && href && !href.startsWith("#"))
        this.issues.warn(`Kauf-Link ohne Artikelnummer: „${text.slice(0, 40)}“ → ${href.slice(0, 70)}. Für das MiniCMS braucht der Link die Artikelnummer (Shop-Link mit Artikelnummer oder data-sku).`);
    }

    const attrs = this.attrs(el, ctx, tag);
    if (VOID.has(tag)) return `<${tag}${attrs}>`;
    const html = `<${tag}${attrs}>${this.inner(el, ctx)}</${tag}>`;

    const standalone =
      parentCtx.top && !parentCtx.loop && (tag === "header" || tag === "footer" || (tag === "nav" && !parentCtx.unit));
    return standalone ? `\n{% if standalone.is_standalone() %}\n${html}\n{% endif %}\n` : html;
  }

  /** Inhalt eines Elements – ein Textblock wird zu einer Übersetzungs-Einheit. */
  private inner(el: Element, ctx: Ctx): string {
    const startsUnit = !ctx.svg && !ctx.unit && !(ctx.loop && ctx.loop.cur) && this.isTextBlock(el);
    if (!startsUnit) return this.children(el, ctx);
    if (ctx.loop) {
      ctx.loop.cur = [];
      const html = this.children(el, ctx);
      if (ctx.loop.cur.length) ctx.loop.units.push(ctx.loop.cur);
      ctx.loop.cur = null;
      return html;
    }
    const unit: { key: string; de: string }[] = [];
    const html = this.children(el, { ...ctx, unit });
    if (unit.length) this.units.push({ keys: unit.map((u) => u.key), de: unit.map((u) => u.de) });
    return html;
  }

  /** Gleich aufgebaute Elemente als {% for %}-Schleife. null = doch nicht möglich. */
  private loop(items: Element[], ctx: Ctx): string | null {
    const id = ++this.loopN;
    const results = items.map((el) => {
      const rec: LoopRec = { slots: [], units: [], cur: null, links: 0, id };
      const html = this.el(el, { ...ctx, loop: rec, unit: null });
      return { html, rec };
    });
    const first = results[0];
    if (results.some((r) => r.html !== first.html || r.rec.slots.length !== first.rec.slots.length)) return null;
    if (!first.html.trim()) return null;

    const sec = ctx.sec;
    const base = `${sec.name}.l${++sec.loops}`;
    const slots = first.rec.slots;
    const constant = slots.map((s, i) => results.every((r) => r.rec.slots[i].value === s.value && r.rec.slots[i].kind === s.kind));
    const itemKey = (j: number) => `${base}.i${j + 1}`;
    const textKeyConst = (i: number) => `${base}.t${i + 1}`;

    // Übersetzungs-Einheiten
    const constUnits = new Set<string>();
    for (const group of first.rec.units) {
      const allConst = group.every((i) => constant[i]);
      if (allConst) {
        const k = group.join(",");
        if (constUnits.has(k)) continue;
        constUnits.add(k);
        this.units.push({ keys: group.map(textKeyConst), de: group.map((i) => slots[i].value) });
        continue;
      }
      results.forEach((r, j) => {
        this.units.push({
          keys: group.map((i) => (constant[i] ? textKeyConst(i) : `${itemKey(j)}.t${i + 1}`)),
          de: group.map((i) => r.rec.slots[i].value),
        });
      });
    }

    const needsKey = slots.some((s, i) => !constant[i] && (s.kind === "text" || s.kind === "attrText"));
    const data = results.map((r, j) => {
      const fields: string[] = [];
      if (needsKey) fields.push(`'k': ${tw(itemKey(j))}`);
      r.rec.slots.forEach((s, i) => {
        if (constant[i] || s.kind === "text" || s.kind === "attrText") return;
        fields.push(`'a${i + 1}': ${s.value}`);
      });
      return `\t{ ${fields.join(", ")} }`;
    });

    const template = first.html.replace(/\u0001(\d+)\u0002/g, (_m, n: string) => {
      const i = Number(n);
      const s = slots[i];
      const esc = s.kind === "attrText" ? " | escape('html_attr')" : "";
      if (s.kind === "text" || s.kind === "attrText") {
        return constant[i] ? `{{ ${tw(textKeyConst(i))} | trans${esc} }}` : `{{ (item.k ~ '.t${i + 1}') | trans${esc} }}`;
      }
      if (s.kind === "sku") return constant[i] ? s.value : `item.a${i + 1}`;
      if (constant[i]) return s.literal !== undefined ? escAttr(s.literal) : `{{ ${s.value} }}`;
      return `{{ item.a${i + 1} }}`;
    });

    return `\n{% for item in [\n${data.join(",\n")}\n] %}\n${template.trim()}\n{% endfor %}\n`;
  }
}
