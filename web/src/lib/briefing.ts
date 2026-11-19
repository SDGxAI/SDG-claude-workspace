import type { BriefingAiText, BriefingStatus } from "@/types/database";

/**
 * Größte Datei, die direkt hochgeladen werden kann (größer → Transferlink).
 * Standard 50 MB (Grenze des kostenlosen Supabase-Tarifs). Nach einem
 * Tarif-Wechsel in Vercel NEXT_PUBLIC_BRIEFING_MAX_MB setzen (z. B. 500) und
 * neu veröffentlichen – passend zur Upload-Grenze in Supabase.
 */
export const BRIEFING_MAX_BYTES =
  (Number(process.env.NEXT_PUBLIC_BRIEFING_MAX_MB) > 0 ? Number(process.env.NEXT_PUBLIC_BRIEFING_MAX_MB) : 50) * 1024 * 1024;

export const BRIEFING_STATUS: Record<BriefingStatus, { label: string; className: string }> = {
  neu: { label: "Neu", className: "bg-sky-50 text-sky-700" },
  in_arbeit: { label: "In Arbeit", className: "bg-amber-50 text-amber-800" },
  erledigt: { label: "Erledigt", className: "bg-emerald-50 text-emerald-700" },
};

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / 1024 / 1024;
  return `${(Number.isInteger(mb) ? String(mb) : mb.toFixed(1)).replace(".", ",")} MB`;
}

/** KI-Text als einfacher Fließtext (zum Kopieren, z. B. in Claude). */
export function aiTextToPlain(t: BriefingAiText): string {
  return [
    `Meta-Title: ${t.meta_title}`,
    `Meta-Description: ${t.meta_description}`,
    "",
    `# ${t.h1}`,
    "",
    t.intro,
    ...t.sections.flatMap((s) => ["", `## ${s.heading}`, "", s.text]),
    "",
    "## Häufige Fragen",
    ...t.faq.flatMap((f) => ["", `**${f.question}**`, f.answer]),
    "",
    `Suchbegriffe: ${t.keywords.join(", ")}`,
  ].join("\n");
}
