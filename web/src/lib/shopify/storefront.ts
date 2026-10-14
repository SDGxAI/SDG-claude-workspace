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

    return { ok: true, html: preparePreviewHtml(html, conn.shop_domain) };
  } catch {
    return { ok: false, error: `Der Shop ${conn.shop_domain} ist nicht erreichbar.` };
  }
}

/**
 * Bereitet die Shop-Seite für die Anzeige in Sites vor:
 * - <base href> auf den Shop, damit Bilder/CSS aus Shopify geladen werden
 * - Skripte entfernen (laufen in der Vorschau ohnehin nicht; spart Platz)
 * - „lazy“ nachgeladene Bilder direkt anzeigen
 * - Einblende-Animationen abschalten, die sonst erst per JavaScript sichtbar würden
 */
export function preparePreviewHtml(html: string, shopDomain: string): string {
  const $ = cheerio.load(html);

  $("script").remove();
  $('link[rel="modulepreload"], link[as="script"]').remove();
  $("base").remove();

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
  head.prepend(`<base href="https://${shopDomain}/">`);
  head.append(
    `<style id="sites-preview-fix">
      .scroll-trigger, [data-aos], .animate--slide-in, .animate--fade-in, .reveal, [data-animate] {
        opacity: 1 !important; transform: none !important; animation: none !important;
      }
      #preview-bar-iframe, #PBarNextFrameWrapper, .shopify-preview-bar { display: none !important; }
    </style>`,
  );

  return $.html();
}
