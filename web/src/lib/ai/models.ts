import "server-only";

export interface ModelOption {
  id: string;
  label: string;
}

/** Fallback, falls die Abfrage nicht klappt (Reihenfolge: schnell → gründlich). */
export const FALLBACK_MODELS: ModelOption[] = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5 (schnell)" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
];

/**
 * Fragt bei Anthropic ab, welche Modelle DIESER Schlüssel nutzen darf, und
 * gibt sie als Auswahlliste zurück. So erscheinen im Menü nur Modelle, die
 * auch wirklich funktionieren.
 */
export async function listAnthropicModels(): Promise<ModelOption[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // Modelle ändern sich selten – eine Stunde zwischenspeichern.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return FALLBACK_MODELS;

    const json = (await res.json()) as {
      data?: { id: string; display_name?: string }[];
    };
    const models = (json.data ?? [])
      .filter((m) => typeof m.id === "string" && m.id.startsWith("claude"))
      .map((m) => ({ id: m.id, label: m.display_name || m.id }));

    return models.length > 0 ? models : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}
