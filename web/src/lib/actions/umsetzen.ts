"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
import { ingestHtmlIntoProject } from "@/lib/ingest/apply";
import type { ContentState, DetectedElement } from "@/types/database";

export type UmsetzenResult =
  | { ok: true }
  | { ok: false; error: string };

const MODEL =
  process.env.ANTHROPIC_UMSETZEN_MODEL ||
  process.env.ANTHROPIC_TRANSLATE_MODEL ||
  "claude-haiku-4-5";

// Sehr große Seiten sprengen das KI-Zeitbudget / die Ausgabegröße.
const MAX_HTML_CHARS = 200_000;

/**
 * Große Bild-/Datenquellen (data:-URIs) durch kurze Platzhalter ersetzen,
 * damit das an die KI gesendete HTML klein bleibt. Gibt das reduzierte HTML
 * und die Liste der Originalwerte zurück.
 */
function stripDataUris(html: string): { html: string; originals: string[] } {
  const originals: string[] = [];
  const stripped = html.replace(/data:[^"')\s]+/g, (match) => {
    const idx = originals.length;
    originals.push(match);
    return `__SDG_ASSET_${idx}__`;
  });
  return { html: stripped, originals };
}

/** Platzhalter wieder durch die Originalwerte ersetzen. */
function restoreDataUris(html: string, originals: string[]): string {
  return html.replace(/__SDG_ASSET_(\d+)__/g, (whole, n) => {
    const i = Number(n);
    return originals[i] ?? whole;
  });
}

/** HTML aus der KI-Antwort lösen (Code-Fences / Vor-/Nachtext tolerant). */
function extractHtml(text: string): string {
  let t = text.trim();
  const fence = /```(?:html)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  return t;
}

/**
 * Setzt einen Kommentar per KI um, indem die KI die GESAMTE Seite anpasst
 * (Text, Bilder, Elemente entfernen/hinzufügen, Layout …). Der vorherige
 * Stand wird als Version gesichert, das Ergebnis wird zur neuen aktuellen
 * Version.
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

  const { data: comment } = await supabase
    .from("comments")
    .select("body")
    .eq("id", commentId)
    .single();
  if (!comment) return { ok: false, error: "Kommentar nicht gefunden." };

  const { data: page } = await supabase
    .from("pages")
    .select("template_html, content_state, detected_elements")
    .eq("id", pageId)
    .single();
  if (!page) return { ok: false, error: "Seite nicht gefunden." };

  // Aktuelles, vollständiges HTML aufbauen (mit den GESPEICHERTEN Bildwerten,
  // nicht mit temporär signierten URLs – so bleiben Bilder dauerhaft gültig).
  const currentHtml = renderHtml(
    page.template_html,
    page.content_state as ContentState,
    page.detected_elements as DetectedElement[],
  );

  const { html: slimHtml, originals } = stripDataUris(currentHtml);
  if (slimHtml.length > MAX_HTML_CHARS) {
    return {
      ok: false,
      error:
        "Diese Seite ist für die automatische Umsetzung zu groß. Bitte die Änderung direkt in Claude vornehmen und über die Schnittstelle einspielen.",
    };
  }

  const system =
    `You are editing the FULL HTML of a marketing landing page for SIMBA-DICKIE-GROUP. ` +
    `You receive the complete current HTML and ONE reviewer feedback (usually German). ` +
    `Apply ONLY the single, specific change the feedback asks for – text wording, colors, ` +
    `removing/hiding an element (e.g. a logo), resizing or swapping an image, small layout tweaks, etc. ` +
    `Change as little as possible; do NOT redesign or "improve" unrelated parts. ` +
    `If the page uses a translation object inside a <script> (i18n), and the feedback is about ` +
    `visible text, change the text there as well so it actually shows. ` +
    `IMPORTANT: The HTML contains placeholder tokens like __SDG_ASSET_0__ that represent images/assets. ` +
    `Keep these tokens byte-for-byte unchanged; never invent, rename, or fill them. You may remove an ` +
    `element that contains such a token if the feedback asks to remove that image. ` +
    `Return the COMPLETE updated HTML document and NOTHING else – no explanations, no code fences.`;

  let updatedHtml: string;
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
        max_tokens: 32000,
        system,
        messages: [
          {
            role: "user",
            content:
              `FEEDBACK:\n${comment.body}\n\n` +
              `CURRENT HTML:\n${slimHtml}`,
          },
        ],
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
      stop_reason?: string;
    };
    if (json.stop_reason === "max_tokens") {
      return {
        ok: false,
        error:
          "Die Seite ist für die automatische Umsetzung zu lang (Antwort abgeschnitten). Bitte die Änderung direkt in Claude vornehmen.",
      };
    }
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    updatedHtml = restoreDataUris(extractHtml(text), originals);
  } catch {
    return {
      ok: false,
      error: "Die KI-Antwort konnte nicht verarbeitet werden. Bitte erneut versuchen.",
    };
  }

  if (!updatedHtml || !/<[a-z][\s\S]*>/i.test(updatedHtml)) {
    return {
      ok: false,
      error: "Die KI hat kein gültiges Ergebnis geliefert. Bitte erneut versuchen.",
    };
  }

  // Sichern + als neue aktuelle Version speichern (nutzt dieselbe Pipeline
  // wie die Claude-Schnittstelle: alte Version archivieren, neu parsen).
  const result = await ingestHtmlIntoProject(supabase, {
    pageId,
    projectId,
    html: updatedHtml,
    source: "umsetzen",
    label: `KI-Umsetzung: ${comment.body.slice(0, 80)}`,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/editor`);
  return { ok: true };
}
