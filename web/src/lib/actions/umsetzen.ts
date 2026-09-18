"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { archiveCurrentAsVersion } from "@/lib/actions/versions";
import type { ContentState, DetectedElement } from "@/types/database";

export type UmsetzenResult =
  | { ok: true; changed: number }
  | { ok: false; error: string };

const MODEL =
  process.env.ANTHROPIC_UMSETZEN_MODEL ||
  process.env.ANTHROPIC_TRANSLATE_MODEL ||
  "claude-haiku-4-5";

interface ChangePayload {
  texts?: Record<string, string>;
  colors?: Record<string, string>;
  i18n_de?: Record<string, string>;
}

/** JSON-Objekt robust aus der Modell-Antwort lösen (Code-Fences tolerant). */
function extractJson(text: string): ChangePayload {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as ChangePayload;
}

/**
 * Setzt einen Kommentar per KI um: schickt die editierbaren Inhalte der Seite
 * (Texte, Farben, ggf. deutsche mehrsprachige Texte) samt Feedback an Claude,
 * übernimmt die zurückgegebenen Änderungen als neuen Stand und sichert den
 * vorherigen Stand automatisch als Version.
 *
 * Bewusst auf das Inhaltsmodell begrenzt (Text/Farbe/Wortlaut) – große
 * strukturelle Umbauten laufen weiterhin über die Claude-Schnittstelle.
 */
export async function umsetzenComment(
  commentId: string,
  pageId: string,
  projectId: string,
): Promise<UmsetzenResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Die KI-Funktion ist noch nicht eingerichtet (KI-Schlüssel fehlt). Bitte im Hosting einen ANTHROPIC_API_KEY hinterlegen.",
    };
  }

  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) {
    return { ok: false, error: "Keine Berechtigung zum Bearbeiten dieser Seite." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: comment } = await supabase
    .from("comments")
    .select("body")
    .eq("id", commentId)
    .single();
  if (!comment) return { ok: false, error: "Kommentar nicht gefunden." };

  const { data: page } = await supabase
    .from("pages")
    .select("content_state, detected_elements")
    .eq("id", pageId)
    .single();
  if (!page) return { ok: false, error: "Seite nicht gefunden." };

  const content = page.content_state as ContentState;
  const detected = (page.detected_elements as DetectedElement[]) ?? [];

  const texts = content.texts ?? {};
  const colors = content.colors ?? {};
  const i18nDe = content.i18n?.["de"] ?? null;

  if (
    Object.keys(texts).length === 0 &&
    Object.keys(colors).length === 0 &&
    !i18nDe
  ) {
    return {
      ok: false,
      error:
        "Diese Seite hat keine editierbaren Text-/Farbfelder, die die KI ändern könnte.",
    };
  }

  // Sprechende Bezeichnungen der Text-Felder als Hilfestellung mitgeben.
  const textLabels: Record<string, string> = {};
  for (const el of detected) {
    if (el.kind === "text" && texts[el.id] !== undefined) {
      textLabels[el.id] = el.label;
    }
  }

  const payload = {
    feedback: comment.body,
    texts,
    text_labels: textLabels,
    colors,
    ...(i18nDe ? { i18n_de: i18nDe } : {}),
  };

  const system =
    `You edit the EDITABLE CONTENT of a marketing landing page for SIMBA-DICKIE-GROUP. ` +
    `You receive a JSON object with: "feedback" (a reviewer's request, usually in German), ` +
    `"texts" (id -> current text), "text_labels" (id -> human label for context), ` +
    `"colors" (id -> CSS color), and optionally "i18n_de" (id -> German text). ` +
    `Apply EXACTLY what the feedback asks and nothing else. ` +
    `Return ONLY a JSON object with the same groups ("texts", "colors", "i18n_de") ` +
    `containing ONLY the entries you changed – omit unchanged entries and omit empty groups. ` +
    `Keep any HTML tags/attributes inside text values intact. ` +
    `Use valid CSS color values for colors. Keep the JSON keys (ids) unchanged. ` +
    `If the request cannot be applied to these fields, return {}. ` +
    `No explanations, no code fences.`;

  let changes: ChangePayload;
  try {
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
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      }),
    });
    if (!res.ok) {
      if (res.status === 401)
        return { ok: false, error: "Der KI-Schlüssel wird abgelehnt (401)." };
      if (res.status === 429)
        return { ok: false, error: "Zu viele KI-Anfragen (429). Bitte kurz warten." };
      if (res.status === 529 || res.status === 500)
        return { ok: false, error: "Die KI ist gerade ausgelastet. Bitte gleich erneut versuchen." };
      return { ok: false, error: `KI-Dienst-Fehler (${res.status}).` };
    }
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    changes = extractJson(text);
  } catch {
    return { ok: false, error: "Die KI-Antwort konnte nicht verarbeitet werden. Bitte erneut versuchen." };
  }

  // Änderungen auf die bekannten Felder anwenden (keine neuen Schlüssel).
  const nextTexts = { ...texts };
  const nextColors = { ...colors };
  const nextI18nDe = i18nDe ? { ...i18nDe } : null;
  let changed = 0;

  for (const [id, val] of Object.entries(changes.texts ?? {})) {
    if (typeof val === "string" && id in nextTexts && val !== nextTexts[id]) {
      nextTexts[id] = val;
      changed += 1;
    }
  }
  for (const [id, val] of Object.entries(changes.colors ?? {})) {
    if (typeof val === "string" && id in nextColors && val !== nextColors[id]) {
      nextColors[id] = val;
      changed += 1;
    }
  }
  if (nextI18nDe) {
    for (const [id, val] of Object.entries(changes.i18n_de ?? {})) {
      if (typeof val === "string" && id in nextI18nDe && val !== nextI18nDe[id]) {
        nextI18nDe[id] = val;
        changed += 1;
      }
    }
  }

  if (changed === 0) {
    return {
      ok: false,
      error:
        "Die KI konnte aus diesem Kommentar keine eindeutige Änderung an Texten/Farben ableiten. Bitte den Kommentar konkreter formulieren – oder die Seite direkt in Claude anpassen.",
    };
  }

  // Aktuellen Stand sichern, dann die Änderungen übernehmen.
  await archiveCurrentAsVersion(
    pageId,
    "umsetzen",
    `KI-Umsetzung: ${comment.body.slice(0, 80)}`,
    supabase,
    user?.id ?? null,
  );

  const nextContent: ContentState = {
    ...content,
    texts: nextTexts,
    colors: nextColors,
    ...(nextI18nDe ? { i18n: { ...content.i18n, de: nextI18nDe } } : {}),
  };

  const { error } = await supabase
    .from("pages")
    .update({ content_state: nextContent })
    .eq("id", pageId);
  if (error) {
    return { ok: false, error: "Die Änderung konnte nicht gespeichert werden." };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/editor`);
  return { ok: true, changed };
}
