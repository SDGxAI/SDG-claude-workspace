import "server-only";
import { createHash } from "crypto";
import { askClaude, parseJson } from "@/lib/ai/claude";
import type { TextUnit } from "./types";

/**
 * Übersetzung der Seitentexte für das MiniCMS (DE/EN/FR) mit Claude.
 * Ein Text kann aus mehreren Teilen bestehen (wegen Fettdruck oder Links
 * dazwischen) – die KI liefert genau so viele Teile zurück.
 * Bereits übersetzte Texte kommen aus dem Zwischenspeicher (`cache`), damit
 * ein erneuter Export schnell ist und gleich bleibt.
 */

export type TranslationCache = Record<string, Partial<Record<string, string[]>>>;

const LANG_NAME: Record<string, string> = {
  de: "Deutsche",
  en: "Englische (britisches Englisch)",
  fr: "Französische",
};

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          parts: { type: "array", items: { type: "string" } },
        },
        required: ["id", "parts"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export function unitHash(u: TextUnit, from: string): string {
  return createHash("sha1").update(`${from}␟${u.de.join("␞")}`).digest("hex").slice(0, 16);
}

function system(from: string, to: string): string {
  return `Du übersetzt Texte einer Produkt-Landingpage der SIMBA DICKIE GROUP (Spielwaren) aus dem ${LANG_NAME[from] ?? from} ins ${LANG_NAME[to] ?? to}.

Regeln:
- Natürlich und werblich, wie von Muttersprachlern für einen Online-Shop geschrieben – nicht Wort für Wort.
- Anrede beibehalten: „Du“ → you bzw. tu, „Sie“ → you bzw. vous.
- Marken-, Produkt- und Serienamen (z. B. BIG Bobby Car, Kawaii Edition), Artikelnummern, Preise, Maße und Zahlen unverändert lassen.
- Nichts hinzufügen oder weglassen, keine neuen Versprechen und keine Umweltaussagen erfinden.
- Jeder Text ist in „parts“ zerlegt, weil dazwischen Formatierungen (fett, Links, Zeilenumbrüche) liegen. Gib GENAU so viele Teile in derselben Reihenfolge zurück, sodass sie aneinandergereiht einen natürlichen Satz ergeben. Keine Leerzeichen am Anfang oder Ende eines Teils.
- Antworte nur mit den übersetzten Texten im vorgegebenen Format, jede id genau einmal.`;
}

async function translateChunk(
  chunk: { id: string; parts: string[] }[],
  from: string,
  to: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const res = await askClaude({
    system: system(from, to),
    user: JSON.stringify({ items: chunk }),
    maxTokens: 8000,
    schema: SCHEMA,
  });
  if (!res.ok || res.truncated) return out;
  const parsed = parseJson<{ items: { id: string; parts: string[] }[] }>(res.text);
  const want = new Map(chunk.map((c) => [c.id, c.parts.length]));
  for (const item of parsed?.items ?? []) {
    if (want.get(item.id) === item.parts?.length && item.parts.every((p) => typeof p === "string" && p.trim()))
      out.set(item.id, item.parts.map((p) => p.trim()));
  }
  return out;
}

/** Übersetzt alle Einheiten nach `to`; Ergebnis in derselben Reihenfolge (null = fehlgeschlagen). */
export async function translateUnits(
  units: TextUnit[],
  from: string,
  to: string,
  cache: TranslationCache,
): Promise<(string[] | null)[]> {
  const ids = units.map((u) => unitHash(u, from));
  const todo = new Map<string, string[]>();
  units.forEach((u, i) => {
    if (!cache[ids[i]]?.[to] && !todo.has(ids[i])) todo.set(ids[i], u.de);
  });

  // Pakete von höchstens ~2500 Zeichen bzw. 30 Texten, alle gleichzeitig
  const chunks: { id: string; parts: string[] }[][] = [];
  let cur: { id: string; parts: string[] }[] = [];
  let size = 0;
  for (const [id, parts] of todo) {
    const len = parts.join(" ").length;
    if (cur.length && (size + len > 2500 || cur.length >= 30)) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push({ id, parts });
    size += len;
  }
  if (cur.length) chunks.push(cur);

  const run = async (chunk: { id: string; parts: string[] }[]) => {
    let got = await translateChunk(chunk, from, to);
    const missing = chunk.filter((c) => !got.has(c.id));
    if (missing.length && missing.length < chunk.length) {
      // fehlende einmal nachfordern
      const again = await translateChunk(missing, from, to);
      got = new Map([...got, ...again]);
    }
    for (const [id, parts] of got) cache[id] = { ...cache[id], [to]: parts };
  };
  await Promise.all(chunks.map(run));

  return ids.map((id) => cache[id]?.[to] ?? null);
}
