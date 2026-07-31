"use server";

import { revalidatePath } from "next/cache";
import * as cheerio from "cheerio";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import type { ContentState } from "@/types/database";

export type TranslateResult =
  | { ok: true; contentState: ContentState; translated: number; targets: string[] }
  | { ok: false; error: string };

// Übersetzung erfolgt durch Claude (Anthropic). Modell per Env-Variable
// überschreibbar; Standard ist ein schnelles, günstiges Modell, das für
// Übersetzungen bestens geeignet ist.
const MODEL = process.env.ANTHROPIC_TRANSLATE_MODEL || "claude-haiku-4-5";

/** Voller Sprachname für die Claude-Anweisung (bessere Ergebnisse als Kürzel). */
function languageName(code: string): string {
  const map: Record<string, string> = {
    de: "German (Deutsch)",
    en: "English",
    fr: "French (Français)",
    it: "Italian",
    es: "Spanish",
    nl: "Dutch",
    pl: "Polish",
    pt: "Portuguese",
  };
  return map[code.toLowerCase().slice(0, 2)] ?? code;
}

/** JSON-Objekt robust aus der Modell-Antwort lösen (Code-Fences etc. tolerant). */
function extractJsonObject(text: string): Record<string, string> {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as Record<string, string>;
}

/**
 * Übersetzt ein Objekt {Schlüssel: deutscher Text} in die Zielsprache – per
 * Claude. Formatierung und Links im Text (<b>, <a href>) bleiben erhalten,
 * URLs/E-Mails werden nicht verändert.
 */
async function claudeTranslate(
  entries: Record<string, string>,
  sourceLang: string,
  targetLang: string,
  apiKey: string,
): Promise<Record<string, string>> {
  const system =
    `You are a professional marketing translator for SIMBA-DICKIE-GROUP, a German toy company. ` +
    `Translate the values of the given JSON object from ${languageName(sourceLang)} to ${languageName(targetLang)}. ` +
    `Rules: keep the tone natural and appropriate for a product landing page; ` +
    `preserve every HTML tag and its attributes exactly (e.g. <b>, <br>, <a href="...">) and translate only the visible text; ` +
    `do NOT translate or modify URLs, email addresses, or placeholder tokens; ` +
    `keep the JSON keys unchanged. ` +
    `Respond with ONLY the translated JSON object – no explanations, no code fences.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: JSON.stringify(entries) }],
    }),
  });

  if (!res.ok) {
    if (res.status === 401)
      throw new Error("Der KI-Schlüssel wird abgelehnt (401). Bitte den ANTHROPIC_API_KEY prüfen.");
    if (res.status === 429)
      throw new Error("Zu viele Anfragen an die KI (429). Bitte einen Moment warten und erneut versuchen.");
    if (res.status === 529 || res.status === 500)
      throw new Error("Die KI ist gerade ausgelastet. Bitte in einem Moment erneut versuchen.");
    throw new Error(`Übersetzungs-Dienst-Fehler (${res.status}).`);
  }

  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
  };
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (!text) throw new Error("Die KI hat keine Übersetzung zurückgegeben.");

  try {
    return extractJsonObject(text);
  } catch {
    throw new Error("Die Übersetzungs-Antwort konnte nicht gelesen werden. Bitte erneut versuchen.");
  }
}

/**
 * Übersetzt die Texte der Quellsprache (Standard: Deutsch) automatisch in alle
 * anderen vorhandenen Sprachen der Seite – per Claude.
 *
 * - Nur echte Texte werden übersetzt. Werte, die als Link-Ziel dienen
 *   (`data-i18n-href`), bleiben unangetastet, damit Verlinkungen korrekt bleiben.
 * - Bestehende Übersetzungen der Zielsprachen werden überschrieben
 *   (im Editor per „Rückgängig" umkehrbar).
 */
export async function translatePageContent(
  pageId: string,
  projectId: string,
  sourceLang = "de",
): Promise<TranslateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Automatische Übersetzung ist noch nicht eingerichtet (KI-Schlüssel fehlt). Bitte im Hosting einen ANTHROPIC_API_KEY hinterlegen.",
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

  // Zu übersetzende Einträge: echte Texte mit Inhalt (keine Link-Ziele).
  const toTranslate: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (!hrefKeys.has(k) && v.trim() !== "") toTranslate[k] = v;
  }

  const nextI18n: Record<string, Record<string, string>> = {};
  for (const lang of Object.keys(i18n)) nextI18n[lang] = { ...i18n[lang] };

  let translatedCount = 0;
  try {
    for (const target of targets) {
      const result = await claudeTranslate(toTranslate, sourceLang, target, apiKey);
      for (const k of Object.keys(toTranslate)) {
        if (typeof result[k] === "string") {
          nextI18n[target][k] = result[k];
          translatedCount += 1;
        }
      }
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
