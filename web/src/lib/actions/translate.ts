"use server";

import { revalidatePath } from "next/cache";
import * as cheerio from "cheerio";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import type { ContentState } from "@/types/database";

export type TranslateResult =
  | { ok: true; contentState: ContentState; translated: number; targets: string[] }
  | { ok: false; error: string };

/** DeepL-Zielsprachcode zu unserem Kürzel (z. B. "en" -> "EN-GB"). */
function deeplTarget(lang: string): string {
  const l = lang.toLowerCase();
  if (l === "en") return "EN-GB";
  if (l === "pt") return "PT-PT";
  return l.slice(0, 2).toUpperCase();
}

/** DeepL-Quellsprachcode (immer 2-stellig, z. B. "de" -> "DE"). */
function deeplSource(lang: string): string {
  return lang.slice(0, 2).toUpperCase();
}

/**
 * Ruft die DeepL-API für eine Liste von Texten auf (max. 50 pro Aufruf).
 * `tag_handling=html` sorgt dafür, dass Formatierung und Links (<b>, <a href>)
 * erhalten bleiben und nur der sichtbare Text übersetzt wird.
 */
async function deeplTranslate(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string,
): Promise<string[]> {
  // Free-Keys enden auf ":fx" und nutzen einen anderen Endpunkt.
  const endpoint = apiKey.trim().endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  const out: string[] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const params = new URLSearchParams();
    params.set("source_lang", deeplSource(sourceLang));
    params.set("target_lang", deeplTarget(targetLang));
    params.set("tag_handling", "html");
    for (const t of batch) params.append("text", t);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!res.ok) {
      if (res.status === 403)
        throw new Error("DeepL lehnt den Schlüssel ab (403). Bitte den API-Schlüssel prüfen.");
      if (res.status === 456)
        throw new Error("DeepL-Kontingent aufgebraucht (456). Bitte Nutzung/Tarif prüfen.");
      if (res.status === 429)
        throw new Error("DeepL ist gerade überlastet (429). Bitte in einem Moment erneut versuchen.");
      throw new Error(`DeepL-Fehler (${res.status}).`);
    }

    const json = (await res.json()) as { translations?: { text: string }[] };
    for (const tr of json.translations ?? []) out.push(tr.text);
  }
  return out;
}

/**
 * Übersetzt die Texte der Quellsprache (Standard: Deutsch) automatisch in alle
 * anderen vorhandenen Sprachen der Seite – per DeepL.
 *
 * - Nur echte Texte werden übersetzt. Werte, die als Link-Ziel dienen
 *   (`data-i18n-href`), bleiben unangetastet, damit Verlinkungen korrekt bleiben.
 * - Bestehende Übersetzungen der Zielsprachen werden dabei überschrieben
 *   (im Editor per „Rückgängig" umkehrbar).
 */
export async function translatePageContent(
  pageId: string,
  projectId: string,
  sourceLang = "de",
): Promise<TranslateResult> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Automatische Übersetzung ist noch nicht eingerichtet (DeepL-Schlüssel fehlt). Bitte im Hosting einen DEEPL_API_KEY hinterlegen.",
    };
  }

  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) {
    return { ok: false, error: "Keine Berechtigung zum Bearbeiten dieser Seite." };
  }

  const supabase = await createClient();
  const { data: page } = await supabase
    .from("pages")
    .select("content_state, template_html")
    .eq("id", pageId)
    .single();
  if (!page) return { ok: false, error: "Seite nicht gefunden." };

  const content = page.content_state as ContentState;
  const i18n = content.i18n;
  if (!i18n || !i18n[sourceLang]) {
    return {
      ok: false,
      error: "Diese Seite hat keine mehrsprachigen Texte in der Ausgangssprache.",
    };
  }

  // Schlüssel, die als Link-Ziel dienen, aus dem HTML ermitteln → nicht übersetzen.
  const $ = cheerio.load(page.template_html as string);
  const hrefKeys = new Set<string>();
  $("[data-i18n-href]").each((_, el) => {
    const k = $(el).attr("data-i18n-href");
    if (k) hrefKeys.add(k);
  });

  const source = i18n[sourceLang];
  const targets = Object.keys(i18n).filter((l) => l !== sourceLang);
  if (targets.length === 0) {
    return { ok: false, error: "Keine weiteren Sprachen zum Übersetzen vorhanden." };
  }

  // Zu übersetzende Schlüssel: echte Texte mit Inhalt (keine Link-Ziele).
  const keysToTranslate = Object.keys(source).filter(
    (k) => !hrefKeys.has(k) && source[k].trim() !== "",
  );

  const nextI18n: Record<string, Record<string, string>> = {};
  for (const lang of Object.keys(i18n)) nextI18n[lang] = { ...i18n[lang] };

  let translatedCount = 0;
  try {
    const values = keysToTranslate.map((k) => source[k]);
    for (const target of targets) {
      const translated = await deeplTranslate(values, sourceLang, target, apiKey);
      keysToTranslate.forEach((k, idx) => {
        if (translated[idx] !== undefined) {
          nextI18n[target][k] = translated[idx];
          translatedCount += 1;
        }
      });
      // Link-Ziele ohne eigenen Zielsprachen-Wert von der Quelle übernehmen.
      for (const k of hrefKeys) {
        if (nextI18n[target][k] === undefined && source[k] !== undefined) {
          nextI18n[target][k] = source[k];
        }
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Übersetzung fehlgeschlagen.",
    };
  }

  const nextContent: ContentState = { ...content, i18n: nextI18n };
  const { error } = await supabase
    .from("pages")
    .update({ content_state: nextContent })
    .eq("id", pageId);
  if (error) {
    return { ok: false, error: "Speichern der Übersetzung fehlgeschlagen." };
  }

  revalidatePath(`/projects/${projectId}`);
  return {
    ok: true,
    contentState: nextContent,
    translated: translatedCount,
    targets,
  };
}
