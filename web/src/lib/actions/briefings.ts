"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { askClaude, defaultModel, listModels, parseJson } from "@/lib/ai/claude";
import { SDG_BRANDS } from "@/lib/brands";
import { emailConfigured, sendMail } from "@/lib/email";
import { buildBrandedEmail } from "@/lib/emailTemplate";
import { BRIEFING_MAX_BYTES } from "@/lib/briefing";
import type { BriefingAiText, BriefingFile, BriefingStatus } from "@/types/database";

type Fail = { ok: false; error: string };
const BUCKET = "briefings";

/** Adresse aufräumen („www.beispiel.de“ → „https://www.beispiel.de“). */
function cleanUrl(value: string | undefined | null): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

const text = (v: string | undefined | null, max: number) => (v ?? "").trim().slice(0, max) || null;

/** Upload eines Fotos/Videos vorbereiten – die Datei geht direkt in den Speicher. */
export async function prepareBriefingUpload(
  name: string,
  type: string,
  size: number,
): Promise<{ ok: true; path: string; token: string } | Fail> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Bitte melde dich erneut an." };
  if (!/^(image|video)\//.test(type)) return { ok: false, error: "Nur Fotos und Videos sind möglich." };
  if (size > BRIEFING_MAX_BYTES) {
    return { ok: false, error: "Zu groß für den Upload – bitte per Transferlink schicken." };
  }
  const safe = name.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-80) || "datei";
  const { data, error } = await createAdminClient()
    .storage.from(BUCKET)
    .createSignedUploadUrl(`${me.id}/${crypto.randomUUID()}-${safe}`);
  if (error || !data) {
    return {
      ok: false,
      error: `Upload konnte nicht vorbereitet werden${error?.message ? ` (${error.message})` : ""}. Ist die SQL-Datei 0018 ausgeführt?`,
    };
  }
  return { ok: true, path: data.path, token: data.token };
}

export interface BriefingInput {
  brand: string;
  title: string;
  goLive?: string;
  productInfo: string;
  /** „Was ist dir wichtig?“ – gewählte Punkte und/oder eigene Worte. */
  important?: string;
  articleNumber?: string;
  ownText?: string;
  wantsAiText: boolean;
  files: BriefingFile[];
  kidsTransferLink?: string;
  noKidsConfirmed: boolean;
  inspirationUrls: string[];
  inspirationNote?: string;
}

/** Briefing einreichen. Admins bekommen eine Mitteilung und eine E-Mail. */
export async function submitBriefing(input: BriefingInput): Promise<{ ok: true; id: string } | Fail> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Bitte melde dich erneut an." };
  if (!SDG_BRANDS.includes(input.brand as (typeof SDG_BRANDS)[number])) {
    return { ok: false, error: "Bitte eine Marke auswählen." };
  }
  const title = text(input.title, 160);
  const productInfo = text(input.productInfo, 8000);
  if (!title) return { ok: false, error: "Bitte das Produkt oder die Aktion nennen." };
  if (!productInfo) return { ok: false, error: "Bitte ein paar Infos zum Produkt eintragen." };
  const files = (Array.isArray(input.files) ? input.files : [])
    .filter((f) => typeof f?.path === "string" && f.path.startsWith(`${me.id}/`) && !f.path.includes(".."))
    .slice(0, 60)
    .map((f) => ({ path: f.path, name: String(f.name).slice(0, 200), type: String(f.type).slice(0, 100), size: Number(f.size) || 0 }));
  if (files.length > 0 && !input.noKidsConfirmed) {
    return { ok: false, error: "Bitte bestätige, dass auf deinen Fotos und Videos keine Kinder zu sehen sind." };
  }
  const ownText = input.wantsAiText ? null : text(input.ownText, 20000);
  if (!input.wantsAiText && !ownText) {
    return { ok: false, error: "Bitte deinen Text eintragen – oder „Bitte für uns schreiben“ wählen." };
  }
  const kidsLink = input.kidsTransferLink?.trim() ? cleanUrl(input.kidsTransferLink) : null;
  if (input.kidsTransferLink?.trim() && !kidsLink) return { ok: false, error: "Der Transferlink ist keine gültige Adresse." };
  const goLive = /^\d{4}-\d{2}-\d{2}$/.test(input.goLive ?? "") ? input.goLive! : null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("briefings")
    .insert({
      brand: input.brand,
      title,
      article_number: text(input.articleNumber, 60),
      important: text(input.important, 1000),
      go_live: goLive,
      product_info: productInfo,
      own_text: ownText,
      wants_ai_text: input.wantsAiText,
      files,
      kids_transfer_link: kidsLink,
      inspiration_urls: (input.inspirationUrls ?? []).map(cleanUrl).filter((u): u is string => !!u).slice(0, 5),
      inspiration_note: text(input.inspirationNote, 1000),
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: /relation|briefings/i.test(error?.message ?? "")
        ? "Briefings sind noch nicht vollständig eingerichtet (SQL-Datei 0018 in Supabase ausführen)."
        : "Das Briefing konnte nicht gespeichert werden. Bitte erneut versuchen.",
    };
  }

  await notifyAdmins({ id: data.id, title, brand: input.brand, from: me.email ?? "Jemand", authorId: me.id });
  revalidatePath("/briefings");
  return { ok: true, id: data.id };
}

async function notifyAdmins(b: { id: string; title: string; brand: string; from: string; authorId: string }) {
  try {
    const admin = createAdminClient();
    const { data: admins } = await admin.from("profiles").select("id, email, name").eq("is_admin", true);
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "") || null;
    const body = `Neues Briefing von ${b.from}: „${b.title}“ (${b.brand})`;
    await Promise.all(
      (admins ?? [])
        .filter((a) => a.id !== b.authorId)
        .map(async (a) => {
          await admin.from("notifications").insert({ user_id: a.id, type: "briefing_new", body });
          if (!emailConfigured() || !a.email) return;
          const mail = buildBrandedEmail({
            subjectHeading: "Neues Briefing",
            greetingName: a.name,
            paragraphs: [`${b.from} hat ein neues Briefing eingereicht:`, `„${b.title}“ – ${b.brand}`],
            button: siteUrl ? { label: "Briefing ansehen →", url: `${siteUrl}/briefings/${b.id}` } : null,
            siteUrl,
          });
          await sendMail(a.email, `Neues Briefing – ${b.title} – SDG Sites`, mail.html, mail.text);
        }),
    );
  } catch {
    /* Benachrichtigung ist Beiwerk – nie blockierend. */
  }
}

async function requireAdmin(): Promise<Fail | null> {
  const me = await getCurrentProfile();
  return me?.is_admin ? null : { ok: false, error: "Nur für Admins." };
}

export async function setBriefingStatus(id: string, status: BriefingStatus): Promise<{ ok: true } | Fail> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!["neu", "in_arbeit", "erledigt"].includes(status)) return { ok: false, error: "Ungültiger Status." };
  const { error } = await (await createClient())
    .from("briefings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: "Status konnte nicht geändert werden." };
  revalidatePath("/briefings");
  revalidatePath(`/briefings/${id}`);
  return { ok: true };
}

export async function deleteBriefing(id: string): Promise<{ ok: true } | Fail> {
  const supabase = await createClient();
  const { data: row } = await supabase.from("briefings").select("files").eq("id", id).maybeSingle();
  const { data: deleted, error } = await supabase.from("briefings").delete().eq("id", id).select("id");
  if (error || !deleted?.length) {
    return { ok: false, error: "Löschen nicht möglich (bereits in Bearbeitung oder keine Berechtigung)." };
  }
  const paths = ((row?.files ?? []) as BriefingFile[]).map((f) => f.path);
  if (paths.length) await createAdminClient().storage.from(BUCKET).remove(paths);
  revalidatePath("/briefings");
  return { ok: true };
}

const TEXT_SYSTEM = `Du schreibst Landingpage-Texte für Marken der SIMBA DICKIE GROUP (Spielwaren). Sprache: Deutsch, warm, klar, familienfreundlich, Du-Ansprache.

Der Text soll SEO- und GEO-optimiert sein:
- SEO: das wichtigste Suchwort natürlich in H1, Einleitung und einer Zwischenüberschrift; Meta-Title höchstens 60 Zeichen, Meta-Description höchstens 155 Zeichen mit Nutzen und Handlungsaufruf.
- GEO (damit KI-Suchmaschinen den Text zitieren): jeder Abschnitt beginnt mit der direkten Antwort bzw. Kernaussage; konkrete, überprüfbare Fakten (Alter, Maße, Material, Funktionen) in eigenen, klaren Sätzen; Marke und Produktname ausgeschrieben; 4–6 FAQ mit Fragen, wie Eltern sie wirklich stellen, und kurzen, eigenständigen Antworten.

Strenge Regeln:
- Nutze NUR Fakten aus dem Briefing. Erfinde keine technischen Daten, Preise, Auszeichnungen, Tests oder Zitate.
- Fehlt eine wichtige Info, schreibe an der Stelle [bitte ergänzen: …] und nenne sie in "missing".
- Keine Umweltaussagen wie „nachhaltig“, „umweltfreundlich“, „klimaneutral“ oder „grün“, außer das Briefing belegt sie konkret (EU-Richtlinie gegen Greenwashing). Keine unbelegten Sicherheits- oder Superlativ-Aussagen („das sicherste“, „das beste“).
- 3–5 Abschnitte, je 2–4 Sätze. Keine Emojis.`;

const TEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meta_title", "meta_description", "h1", "intro", "sections", "faq", "keywords", "missing"],
  properties: {
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    h1: { type: "string" },
    intro: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "text"],
        properties: { heading: { type: "string" }, text: { type: "string" } },
      },
    },
    faq: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: { question: { type: "string" }, answer: { type: "string" } },
      },
    },
    keywords: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "string" } },
  },
};

/** SEO- und GEO-optimierten Seitentext aus dem Briefing erstellen (Admins). */
export async function generateBriefingText(id: string): Promise<{ ok: true; text: BriefingAiText } | Fail> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const supabase = await createClient();
  const { data: b } = await supabase.from("briefings").select("*").eq("id", id).maybeSingle();
  if (!b) return { ok: false, error: "Briefing nicht gefunden." };

  // Für Texte lieber ein gründlicheres Modell, wenn verfügbar.
  const ids = new Set((await listModels()).map((m) => m.id));
  const model = ["claude-sonnet-5-5", "claude-sonnet-4-5"].find((m) => ids.has(m)) ?? (await defaultModel());
  const res = await askClaude({
    system: TEXT_SYSTEM,
    user:
      `Marke: ${b.brand}\nProdukt / Aktion: ${b.title}\n` +
      (b.article_number ? `Artikelnummer: ${b.article_number}\n` : "") +
      (b.important ? `Was der Marke wichtig ist: ${b.important}\n` : "") +
      `\nProduktinfos:\n${b.product_info}\n` +
      (b.own_text ? `\nVorhandener Text der Marke (Inhalte übernehmen, sprachlich optimieren):\n${b.own_text}\n` : "") +
      (b.inspiration_note ? `\nWas der Marke an ihren Vorbildern gefällt: ${b.inspiration_note}\n` : ""),
    maxTokens: 4000,
    model,
    effort: "medium",
    schema: TEXT_SCHEMA,
  });
  if (!res.ok) return res;
  const parsed = parseJson<BriefingAiText>(res.text);
  if (!parsed?.h1 || !Array.isArray(parsed.sections)) {
    return { ok: false, error: "Die KI hat keinen verwertbaren Text geliefert. Bitte erneut versuchen." };
  }
  const { error } = await supabase
    .from("briefings")
    .update({ ai_text: parsed, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: "Der Text konnte nicht gespeichert werden." };
  revalidatePath(`/briefings/${id}`);
  return { ok: true, text: parsed };
}
