import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";

/** Einziger Zugang zur Claude-API (offizielles SDK) für die ganze App. */

export type AskResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: string };

export type AiEffort = "low" | "medium" | "high";
/** Gründlichkeit, wie sie in der Oberfläche heißt. */
export type Effort = "standard" | "mittel" | "hoch";
export const EFFORT: Record<Effort, AiEffort> = { standard: "low", mittel: "medium", hoch: "high" };

export interface ModelOption {
  id: string;
  label: string;
}

/** Bevorzugte Standard-Modelle (schnell zuerst); das erste verfügbare gewinnt. */
const PREFERRED = ["claude-haiku-5-5", "claude-haiku-4-5"];
const ENV_MODEL =
  process.env.ANTHROPIC_UMSETZEN_MODEL || process.env.ANTHROPIC_TRANSLATE_MODEL || "";

/** Ältere Modelle kennen den Parameter „effort“ nicht. */
const NO_EFFORT = /haiku-4-5|sonnet-4-5|opus-4-1|claude-3/;

function client(): Anthropic | null {
  return process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 0, timeout: 55_000 }) : null;
}

/** Modelle, die dieser Schlüssel nutzen darf (eine Stunde zwischengespeichert). */
export const listModels = unstable_cache(
  async (): Promise<ModelOption[]> => {
    const c = client();
    if (!c) return [];
    try {
      const out: ModelOption[] = [];
      for await (const m of c.models.list({ limit: 100 })) {
        if (m.id.startsWith("claude")) out.push({ id: m.id, label: m.display_name || m.id });
      }
      return out;
    } catch {
      return [];
    }
  },
  ["anthropic-models"],
  { revalidate: 3600 },
);

/** Standard-Modell: Vorgabe aus dem Hosting, sonst das schnellste verfügbare. */
export async function defaultModel(): Promise<string> {
  if (ENV_MODEL) return ENV_MODEL;
  const ids = new Set((await listModels()).map((m) => m.id));
  return PREFERRED.find((id) => ids.has(id)) ?? PREFERRED[PREFERRED.length - 1];
}

/**
 * Eine Anfrage an Claude. Mit `schema` antwortet das Modell garantiert als
 * JSON in dieser Form (strukturierte Ausgabe); ältere Modelle ohne diese
 * Funktion bekommen die Anfrage automatisch ohne sie.
 */
export async function askClaude(opts: {
  system: string;
  user: string;
  maxTokens: number;
  model?: string;
  effort?: AiEffort;
  schema?: Record<string, unknown>;
}): Promise<AskResult> {
  const c = client();
  if (!c) {
    return {
      ok: false,
      error:
        "Die KI-Funktion ist noch nicht eingerichtet (KI-Schlüssel fehlt). Bitte im Hosting einen ANTHROPIC_API_KEY hinterlegen.",
    };
  }
  const model = opts.model?.trim() || (await defaultModel());
  const base = {
    model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user" as const, content: opts.user }],
  };
  const outputConfig: Anthropic.OutputConfig = {
    ...(NO_EFFORT.test(model) ? {} : { effort: opts.effort ?? "low" }),
    ...(opts.schema ? { format: { type: "json_schema", schema: opts.schema } } : {}),
  };
  const withConfig = Object.keys(outputConfig).length > 0;

  try {
    let message: Anthropic.Message;
    try {
      message = await c.messages.create({
        ...base,
        ...(withConfig ? { output_config: outputConfig } : {}),
      });
    } catch (err) {
      // Modell kennt effort/strukturierte Ausgabe nicht → einmal ohne versuchen.
      if (!(err instanceof Anthropic.BadRequestError) || !withConfig) throw err;
      message = await c.messages.create(base);
    }
    if (message.stop_reason === "refusal") {
      return { ok: false, error: "Die KI hat diese Anfrage abgelehnt. Bitte anders formulieren." };
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { ok: true, text, truncated: message.stop_reason === "max_tokens" };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      return { ok: false, error: "Der KI-Schlüssel wird abgelehnt (401)." };
    if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError)
      return {
        ok: false,
        error: `Das gewählte KI-Modell „${model}“ ist mit diesem Schlüssel nicht nutzbar. Bitte ein anderes Modell wählen.`,
      };
    if (err instanceof Anthropic.RateLimitError)
      return { ok: false, error: "Zu viele KI-Anfragen. Bitte kurz warten." };
    if (err instanceof Anthropic.BadRequestError)
      return { ok: false, error: `Die KI konnte die Anfrage nicht verarbeiten (${err.message}).` };
    if (err instanceof Anthropic.APIConnectionTimeoutError)
      return { ok: false, error: "Die KI hat zu lange gebraucht. Bitte die Änderung kleiner fassen oder ein schnelleres Modell wählen." };
    if (err instanceof Anthropic.APIConnectionError)
      return { ok: false, error: "Die KI ist gerade nicht erreichbar. Bitte gleich erneut versuchen." };
    if (err instanceof Anthropic.APIError)
      return { ok: false, error: `Die KI ist gerade ausgelastet (${err.status ?? "Fehler"}). Bitte gleich erneut versuchen.` };
    return { ok: false, error: "Die KI-Antwort konnte nicht verarbeitet werden. Bitte erneut versuchen." };
  }
}

/** JSON aus einer KI-Antwort lesen (tolerant gegenüber Code-Zäunen). */
export function parseJson<T>(text: string): T | null {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}
