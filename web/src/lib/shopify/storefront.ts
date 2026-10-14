import "server-only";
import * as cheerio from "cheerio";
import type { Fail, Ok, ShopifyConnection } from "@/lib/shopify/client";
import { normalizeShopPath, themeNumericId } from "@/lib/shopify/paths";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SDG-Sites";

/** Sehr einfacher Cookie-Speicher für eine Abruf-Sitzung. */
class CookieJar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    const list =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : (res.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/);
    for (const raw of list) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function request(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  followRedirects = true,
): Promise<{ res: Response; finalUrl: string }> {
  let current = url;
  let options: RequestInit = init;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, {
      ...options,
      redirect: "manual",
      cache: "no-store",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "de-DE,de;q=0.9",
        ...(options.headers ?? {}),
        cookie: jar.header(),
      },
    });
    jar.store(res);
    const location = res.headers.get("location");
    if (followRedirects && res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      options = {}; // Folge-Requests immer als GET
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error("too many redirects");
}

/**
 * Holt die gerenderte Seite eines (nicht veröffentlichten) Themes, so wie sie
 * in der Shopify-Vorschau aussieht. Ist der Shop noch passwortgeschützt, wird
 * vorher das Onlineshop-Passwort eingegeben.
 */
export async function fetchThemePreviewHtml(
  conn: ShopifyConnection,
  themeId: string,
  path: string,
  options: { raw?: boolean } = {},
): Promise<Ok<{ html: string }> | Fail> {
  const jar = new CookieJar();
  const base = `https://${conn.shop_domain}`;
  const numericId = themeNumericId(themeId);

  try {
    if (conn.storefront_password?.trim()) {
      const body = new URLSearchParams({
        form_type: "storefront_password",
        utf8: "✓",
        password: conn.storefront_password.trim(),
      });
      await request(jar, `${base}/password`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }, false); // nur das Cookie wird gebraucht, keine Weiterleitung
    }

    const target = `${base}${normalizeShopPath(path)}?preview_theme_id=${numericId}&_fd=0`;
    const { res, finalUrl } = await request(jar, target);

    if (new URL(finalUrl).pathname.startsWith("/password")) {
      return {
        ok: false,
        error: conn.storefront_password
          ? "Das Onlineshop-Passwort wurde nicht akzeptiert. Bitte in den Shop-Einstellungen von Sites prüfen."
          : "Der Shop ist passwortgeschützt. Bitte das Onlineshop-Passwort beim Shop in Sites hinterlegen.",
      };
    }
    if (res.status === 404) {
      return { ok: false, error: `Die Seite „${normalizeShopPath(path)}“ gibt es in diesem Shop nicht (404).` };
    }
    if (res.status === 429 || res.status === 430) {
      return { ok: false, error: "Shopify bremst gerade die Abrufe (zu viele Anfragen). Bitte in einer Minute erneut versuchen." };
    }
    if (!res.ok) {
      return { ok: false, error: `Die Vorschau konnte nicht geladen werden (${res.status}).` };
    }

    const html = await res.text();
    if (!/<html[\s>]/i.test(html)) {
      return { ok: false, error: "Shopify hat keine gültige Seite geliefert." };
    }

    // Sicherstellen, dass wirklich das gewählte Theme angezeigt wird.
    const themeMatch = /Shopify\.theme\s*=\s*\{[^}]*?"id"\s*:\s*(\d+)/.exec(html);
    if (themeMatch && themeMatch[1] !== numericId) {
      return {
        ok: false,
        error:
          "Shopify zeigt nicht das gewählte Vorschau-Theme an. Ist das Theme noch vorhanden und nicht in Bearbeitung?",
      };
    }

    if (options.raw) return { ok: true, html };
    return { ok: true, html: await preparePreviewHtml(html, conn.shop_domain) };
  } catch {
    return { ok: false, error: `Der Shop ${conn.shop_domain} ist nicht erreichbar.` };
  }
}

/**
 * Cookie-Banner und Vorschauleiste in der Sites-Vorschau ausblenden. Die
 * abgeschottete Vorschau kann sich keine Cookie-Zustimmung merken – der Banner
 * würde sonst bei jedem Laden die Seite verdecken. Im echten Shop bleibt er.
 */
const COOKIE_BANNER_CSS = [
  "#preview-bar-iframe", "#PBarNextFrameWrapper", ".shopify-preview-bar",
  // Shopify-eigener Cookie-Banner
  "#shopify-pc__banner", "#shopify-pc__prefs", ".shopify-pc__banner__dialog", ".shopify-pc__prefs__dialog",
  // verbreitete Consent-Tools
  "#onetrust-consent-sdk", "#onetrust-banner-sdk", "#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay",
  "#usercentrics-root", "#usercentrics-cmp-ui", "#cmpbox", "#cmpbox2", ".cmpboxBG",
  "#pandectes-banner", ".pd-cp-ui", ".isense-cc-window", "#cookiescript_injected", "#cookiescript_injected_wrapper",
  ".cc-window", ".cc-banner", ".cc-revoke", "#cookie-bar", "#cookie-banner", ".cookie-banner", "#cookie-consent",
  ".cookie-consent", ".cookies-banner", "#cookie-notice", ".cookie-notice", "#gdpr-cookie-consent",
  ".gdpr-cookie-banner", "#shopify-section-cookie-banner", "[aria-label='cookieconsent']",
].join(",") + "{display:none!important}body{overflow-y:auto!important}";

/** Angenommene Fensterhöhe der Vorschau: 1vh = 9px (≈ 900px Bildschirm). */
const VH_PX = 9;

/**
 * Bildschirm-Einheiten (vh/svh/dvh/lvh) in feste Pixel umrechnen. In Sites
 * ist die Vorschau so hoch wie die ganze Seite – „100vh“ würde sonst die
 * komplette Seitenhöhe bedeuten und sich endlos aufblähen.
 */
export function fixViewportUnits(css: string): string {
  return css.replace(/(-?(?:\d+\.\d+|\.\d+|\d+))(?:s|d|l)?vh\b/gi, (_, n: string) => {
    const px = Math.round(parseFloat(n) * VH_PX * 100) / 100;
    return `${px}px`;
  });
}

/** Relative url(...)/@import in einer CSS-Datei auf absolute Adressen umstellen. */
export function absolutizeCssUrls(css: string, cssUrl: string): string {
  const abs = (ref: string) => {
    const r = ref.trim();
    if (!r || /^(data:|https?:|#)/i.test(r)) return r;
    try {
      return new URL(r, cssUrl).toString();
    } catch {
      return r;
    }
  };
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q: string, ref: string) => `url(${q}${abs(ref)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q: string, ref: string) => `@import ${q}${abs(ref)}${q}`);
}

async function fetchCss(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "user-agent": BROWSER_UA, accept: "text/css,*/*;q=0.1" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 1_500_000 ? null : text;
  } catch {
    return null;
  }
}

/**
 * Bereitet die Shop-Seite für die Anzeige in Sites vor:
 * - <base href> auf den Shop, damit Bilder/CSS aus Shopify geladen werden
 * - Shopify-Vorschauleiste entfernen (Theme-Skripte bleiben erhalten)
 * - CSS, das sonst erst per JavaScript aktiviert würde, direkt aktivieren
 * - Stylesheets einbetten und Bildschirm-Einheiten (vh) in Pixel umrechnen
 * - „lazy“ nachgeladene Bilder direkt anzeigen
 * - Einblende-Animationen und Lade-Bildschirme abschalten
 */
export async function preparePreviewHtml(html: string, shopDomain: string): Promise<string> {
  const $ = cheerio.load(html);
  const pageUrl = `https://${shopDomain}/`;

  // Theme-Skripte bleiben erhalten (die Vorschau führt sie abgeschottet aus),
  // nur die Shopify-Vorschauleiste wird entfernt.
  $("script").each((_, el) => {
    const node = $(el);
    const src = node.attr("src") ?? "";
    if (/preview_bar|previewbar/i.test(src) || /previewBarInjector|preview_bar_injector/i.test(node.text())) {
      node.remove();
    }
  });
  $("base").remove();

  // CSS, das per onload-Trick nachgeladen wird, direkt aktiv schalten.
  $('link[rel="preload"][as="style"]').each((_, el) => {
    $(el).attr("rel", "stylesheet").removeAttr("as").removeAttr("onload");
  });
  $('link[rel="stylesheet"][media="print"][onload]').each((_, el) => {
    $(el).attr("media", "all").removeAttr("onload");
  });

  // Stylesheets einbetten (parallel, mit Obergrenze).
  const links = $('link[rel="stylesheet"][href]').toArray().slice(0, 30);
  await Promise.all(
    links.map(async (el) => {
      const link = $(el);
      let url: string;
      try {
        url = new URL(link.attr("href") ?? "", pageUrl).toString();
      } catch {
        return;
      }
      const css = await fetchCss(url);
      if (css === null) return;
      const media = (link.attr("media") ?? "").trim();
      let body = fixViewportUnits(absolutizeCssUrls(css, url));
      if (media && media !== "all") body = `@media ${media}{${body}}`;
      link.replaceWith(`<style data-sites-href="${url.replace(/"/g, "&quot;")}">${body}</style>`);
    }),
  );

  // Auch eingebettete Styles und style-Attribute umrechnen.
  $("style").each((_, el) => {
    const node = $(el);
    if (node.attr("data-sites-href")) return;
    node.text(fixViewportUnits(node.text()));
  });
  $("[style]").each((_, el) => {
    const node = $(el);
    const style = node.attr("style") ?? "";
    if (/vh\b/i.test(style)) node.attr("style", fixViewportUnits(style));
  });

  $("img").each((_, el) => {
    const img = $(el);
    const src = img.attr("src") ?? "";
    const dataSrc = img.attr("data-src") || img.attr("data-original");
    if (dataSrc && (!src || src.startsWith("data:"))) img.attr("src", dataSrc);
    const dataSrcset = img.attr("data-srcset");
    if (dataSrcset && !img.attr("srcset")) img.attr("srcset", dataSrcset);
    if ((img.attr("srcset") ?? "").includes("{width}")) {
      img.attr("srcset", (img.attr("srcset") ?? "").replace(/\{width\}/g, "800"));
    }
  });

  const head = $("head");
  head.prepend(`<base href="${pageUrl}">`);
  head.append(
    `<style id="sites-preview-fix">
      html, body { opacity: 1 !important; visibility: visible !important; }
      .scroll-trigger, [data-aos], .animate--slide-in, .animate--fade-in, .reveal, [data-animate] {
        opacity: 1 !important; transform: none !important; animation: none !important;
      }
      body .preloader, body #preloader, body .page-loader, body #page-loader,
      body .loading-screen, body .splash-screen, body .loader-wrapper,
      #preview-bar-iframe, #PBarNextFrameWrapper, .shopify-preview-bar {
        display: none !important;
      }
      ${COOKIE_BANNER_CSS}
    </style>`,
  );

  return $.html();
}

/**
 * Live-Ansicht: die Shop-Seite möglichst UNVERÄNDERT anzeigen (echtes
 * Scrollfenster, eigene Bildschirmhöhe). Dazu kommen nur:
 * - <base> auf den Shop und das Hilfsskript
 * - Skripte/Module vom Shop über die Sites-Durchleitung (die abgeschottete
 *   Vorschau darf Module sonst evtl. nicht laden)
 * - Ausblenden der Shopify-Vorschauleiste
 */
export function prepareLiveHtml(
  html: string,
  shopDomain: string,
  bridge: string,
  proxyBase: string,
): string {
  const $ = cheerio.load(html);
  const shopRoot = `https://${shopDomain}/`;
  const toProxy = (raw: string | undefined): string | undefined => {
    if (!raw) return raw;
    try {
      const u = new URL(raw, shopRoot);
      if (u.host !== shopDomain) return raw;
      return `${proxyBase}${u.pathname}${u.search}`;
    } catch {
      return raw;
    }
  };
  const shopUrlRe = new RegExp(`(?:https?:)?//${shopDomain.replace(/\./g, "\\.")}/`, "g");

  $("script").each((_, el) => {
    const node = $(el);
    const src = node.attr("src") ?? "";
    if (/preview_bar|previewbar/i.test(src) || /previewBarInjector|preview_bar_injector/i.test(node.text())) {
      node.remove();
      return;
    }
    if (src) {
      node.attr("src", toProxy(src) ?? src);
      return;
    }
    const type = (node.attr("type") ?? "").toLowerCase();
    if (type === "importmap") {
      try {
        const map = JSON.parse(node.text()) as {
          imports?: Record<string, string>;
          scopes?: Record<string, Record<string, string>>;
        };
        const fix = (rec?: Record<string, string>) => {
          if (!rec) return rec;
          return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, toProxy(v) ?? v]));
        };
        map.imports = fix(map.imports);
        if (map.scopes) {
          map.scopes = Object.fromEntries(
            Object.entries(map.scopes).map(([scope, rec]) => [toProxy(scope) ?? scope, fix(rec)!]),
          );
        }
        node.text(JSON.stringify(map));
      } catch {
        /* unverändert lassen */
      }
    } else if (type === "module") {
      node.text(node.text().replace(shopUrlRe, `${proxyBase}/`));
    }
  });
  $('link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]').each((_, el) => {
    const node = $(el);
    node.attr("href", toProxy(node.attr("href")) ?? node.attr("href") ?? "");
  });

  $("base").remove();
  const head = $("head");
  head.prepend(`<script>${bridge.replace(/<\//g, "<\\/")}</script>`);
  head.prepend(`<base href="${shopRoot}" target="_blank">`);
  head.append(`<style id="sites-live-fix">${COOKIE_BANNER_CSS}</style>`);
  return $.html();
}
