import "server-only";

export type EditHtmlResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

const MODEL =
  process.env.ANTHROPIC_UMSETZEN_MODEL ||
  process.env.ANTHROPIC_TRANSLATE_MODEL ||
  "claude-haiku-4-5";

// Sehr große Seiten sprengen das KI-Zeitbudget / die Ausgabegröße.
const MAX_HTML_CHARS = 200_000;

/** Große data:-URIs durch kurze Platzhalter ersetzen (klein/günstig senden). */
function stripDataUris(html: string): { html: string; originals: string[] } {
  const originals: string[] = [];
  const stripped = html.replace(/data:[^"')\s]+/g, (match) => {
    const idx = originals.length;
    originals.push(match);
    return `__SDG_ASSET_${idx}__`;
  });
  return { html: stripped, originals };
}

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
 * Lässt die KI die GESAMTE Seite anhand einer Anweisung anpassen und gibt das
 * vollständige, neue HTML zurück. Genutzt vom „✨ Umsetzen"-Knopf und von der
 * KI-Bearbeiten-Ebene. Große Bilddaten werden zum Senden ausgeblendet und
 * danach exakt wiederhergestellt.
 */
export async function editHtmlWithAI(
  currentHtml: string,
  instruction: string,
): Promise<EditHtmlResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Die KI-Funktion ist noch nicht eingerichtet (KI-Schlüssel fehlt). Bitte im Hosting einen ANTHROPIC_API_KEY hinterlegen.",
    };
  }

  const { html: slimHtml, originals } = stripDataUris(currentHtml);
  if (slimHtml.length > MAX_HTML_CHARS) {
    return {
      ok: false,
      error:
        "Diese Seite ist für die automatische Bearbeitung zu groß. Bitte die Änderung direkt in Claude vornehmen und über die Schnittstelle einspielen.",
    };
  }

  const system =
    `You are editing the FULL HTML of a marketing landing page for SIMBA-DICKIE-GROUP. ` +
    `You receive the complete current HTML and an INSTRUCTION (usually German, may contain several requests). ` +
    `Apply exactly what the instruction asks – text wording, colors, removing/hiding elements (e.g. a logo), ` +
    `resizing or swapping images, layout tweaks, adding sections, etc. ` +
    `Change what is requested and keep everything else intact; do not redesign unrelated parts. ` +
    `If the page uses a translation object inside a <script> (i18n) and the instruction concerns visible text, ` +
    `change the text there too so it actually shows. ` +
    `IMPORTANT: The HTML contains placeholder tokens like __SDG_ASSET_0__ that represent images/assets. ` +
    `Keep these tokens byte-for-byte unchanged; never invent, rename, or fill them. You may remove an element ` +
    `that contains such a token if asked to remove that image. ` +
    `Return the COMPLETE updated HTML document and NOTHING else – no explanations, no code fences.`;

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
            content: `INSTRUCTION:\n${instruction}\n\nCURRENT HTML:\n${slimHtml}`,
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
          "Die Seite ist für die automatische Bearbeitung zu lang (Antwort abgeschnitten). Bitte direkt in Claude anpassen.",
      };
    }
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const updatedHtml = restoreDataUris(extractHtml(text), originals);
    if (!updatedHtml || !/<[a-z][\s\S]*>/i.test(updatedHtml)) {
      return { ok: false, error: "Die KI hat kein gültiges HTML geliefert. Bitte erneut versuchen." };
    }
    return { ok: true, html: updatedHtml };
  } catch {
    return {
      ok: false,
      error: "Die KI-Antwort konnte nicht verarbeitet werden. Bitte erneut versuchen.",
    };
  }
}
