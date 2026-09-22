import "server-only";

export type EditHtmlResult =
  | { ok: true; html: string; summary?: string }
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

function extractHtml(text: string): string {
  let t = text.trim();
  const fence = /```(?:html)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  return t;
}

interface Edit {
  find: string;
  replace: string;
}

function extractJson(text: string): { edits?: Edit[]; summary?: string } {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/** Exakte Ersetzungen anwenden; gibt neues HTML + Anzahl angewandter Edits. */
function applyEdits(
  html: string,
  edits: Edit[],
): { html: string; applied: number } {
  let result = html;
  let applied = 0;
  for (const e of edits) {
    if (typeof e?.find !== "string" || typeof e?.replace !== "string") continue;
    if (e.find === "") continue;
    const idx = result.indexOf(e.find);
    if (idx >= 0) {
      result = result.slice(0, idx) + e.replace + result.slice(idx + e.find.length);
      applied += 1;
    }
  }
  return { html: result, applied };
}

async function callClaude(
  apiKey: string,
  system: string,
  userContent: string,
  maxTokens: number,
): Promise<
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: string }
> {
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
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userContent }],
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
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return { ok: true, text, truncated: json.stop_reason === "max_tokens" };
  } catch {
    return { ok: false, error: "Die KI-Antwort konnte nicht verarbeitet werden. Bitte erneut versuchen." };
  }
}

const ASSET_RULE =
  `The HTML contains placeholder tokens like __SDG_ASSET_0__ that represent existing images. ` +
  `Keep these tokens byte-for-byte unchanged. To insert a NEW image, use a normal <img src="..."> with the ` +
  `image URL given in the instruction (if any).`;

/**
 * Lässt die KI die Seite anhand einer Anweisung anpassen. Schneller Weg:
 * die KI liefert nur die geänderten Stellen (find/replace). Klappt das nicht,
 * wird auf die vollständige Neuausgabe des HTML zurückgefallen.
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

  // --- Schneller Weg: gezielte Ersetzungen -------------------------------
  const editSystem =
    `You edit the HTML of a SIMBA-DICKIE-GROUP marketing landing page. ` +
    `You get the full current HTML and an INSTRUCTION (usually German, may contain several requests). ` +
    `Return ONLY a JSON object: {"edits":[{"find":"<verbatim substring of the HTML>","replace":"<new html>"}],"summary":"<one short German sentence>"}. ` +
    `Each "find" MUST be an exact, contiguous substring copied character-for-character from the provided HTML, ` +
    `long/unique enough to occur only once. Make the SMALLEST edits that satisfy the instruction. ` +
    `To insert, set "find" to an existing nearby snippet and "replace" to that snippet plus the new HTML. ` +
    `To delete an element, set "replace" to "". If the page uses a translation object in a <script> (i18n) ` +
    `and the instruction is about visible text, edit the text there too. ${ASSET_RULE} ` +
    `No explanations, no code fences – only the JSON.`;

  const editRes = await callClaude(
    apiKey,
    editSystem,
    `INSTRUCTION:\n${instruction}\n\nCURRENT HTML:\n${slimHtml}`,
    8000,
  );
  if (!editRes.ok) return { ok: false, error: editRes.error };

  if (!editRes.truncated) {
    try {
      const parsed = extractJson(editRes.text);
      const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
      if (edits.length > 0) {
        const { html: newSlim, applied } = applyEdits(slimHtml, edits);
        if (applied > 0 && newSlim !== slimHtml) {
          return {
            ok: true,
            html: restoreDataUris(newSlim, originals),
            summary: parsed.summary,
          };
        }
      }
    } catch {
      /* JSON unbrauchbar → Fallback unten */
    }
  }

  // --- Sicherer Fallback: vollständiges HTML -----------------------------
  const fullSystem =
    `You are editing the FULL HTML of a SIMBA-DICKIE-GROUP marketing landing page. ` +
    `Apply exactly what the instruction asks and keep everything else intact; do not redesign unrelated parts. ` +
    `If the page uses a translation object in a <script> (i18n) and the instruction concerns visible text, change it there too. ` +
    `${ASSET_RULE} Return the COMPLETE updated HTML document and NOTHING else – no explanations, no code fences.`;

  const fullRes = await callClaude(
    apiKey,
    fullSystem,
    `INSTRUCTION:\n${instruction}\n\nCURRENT HTML:\n${slimHtml}`,
    32000,
  );
  if (!fullRes.ok) return { ok: false, error: fullRes.error };
  if (fullRes.truncated) {
    return {
      ok: false,
      error:
        "Die Seite ist für die automatische Bearbeitung zu lang (Antwort abgeschnitten). Bitte direkt in Claude anpassen.",
    };
  }

  const updatedHtml = restoreDataUris(extractHtml(fullRes.text), originals);
  if (!updatedHtml || !/<[a-z][\s\S]*>/i.test(updatedHtml)) {
    return { ok: false, error: "Die KI hat kein gültiges Ergebnis geliefert. Bitte erneut versuchen." };
  }
  return { ok: true, html: updatedHtml };
}
