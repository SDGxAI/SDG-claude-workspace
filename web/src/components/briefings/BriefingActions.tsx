"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteBriefing, generateBriefingText, setBriefingStatus } from "@/lib/actions/briefings";
import { aiTextToPlain, BRIEFING_STATUS } from "@/lib/briefing";
import type { BriefingAiText, BriefingStatus } from "@/types/database";

interface Briefing {
  id: string;
  brand: string;
  title: string;
  status: BriefingStatus;
  productInfo: string;
  important: string | null;
  ownText: string | null;
  inspirationUrls: string[];
  inspirationNote: string | null;
  aiText: BriefingAiText | null;
}

/** Anleitung für Claude: daraus entsteht der erste Wurf der Landingpage. */
function claudePrompt(b: Briefing): string {
  return [
    `Erstelle eine moderne, einladende Landingpage (eine HTML-Datei) für die Marke ${b.brand}: „${b.title}“.`,
    "",
    "Produktinfos:",
    b.productInfo,
    b.important ? `\nWas der Marke wichtig ist: ${b.important}` : "",
    b.aiText ? `\nVerwende diesen Text:\n\n${aiTextToPlain(b.aiText)}` : b.ownText ? `\nVerwende diesen Text:\n\n${b.ownText}` : "",
    b.inspirationUrls.length ? `\nInspiration: ${b.inspirationUrls.join(", ")}${b.inspirationNote ? ` – ${b.inspirationNote}` : ""}` : "",
    "",
    "Bilder: Setze gut sichtbare Platzhalter ein. Die echten Fotos tragen wir danach von Hand in SDG Sites ein.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

async function copy(text: string, done: () => void) {
  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    window.prompt("Zum Kopieren markieren:", text);
  }
}

export function BriefingActions({ briefing, isAdmin, canDelete }: { briefing: Briefing; isAdmin: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function changeStatus(status: BriefingStatus) {
    setBusy(true);
    const res = await setBriefingStatus(briefing.id, status);
    setBusy(false);
    if (!res.ok) window.alert(res.error);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Dieses Briefing samt Dateien löschen?")) return;
    setBusy(true);
    const res = await deleteBriefing(briefing.id);
    setBusy(false);
    if (!res.ok) return window.alert(res.error);
    router.push("/briefings");
    router.refresh();
  }

  return (
    <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
      {isAdmin && (
        <section className="rounded-3xl border border-white bg-white/90 p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Status</h2>
          <div className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-neutral-100 p-1">
            {(Object.keys(BRIEFING_STATUS) as BriefingStatus[]).map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => changeStatus(s)}
                className={`rounded-full px-2 py-1.5 text-xs font-semibold transition ${
                  briefing.status === s ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {BRIEFING_STATUS[s].label}
              </button>
            ))}
          </div>
          <button
            onClick={() => copy(claudePrompt(briefing), () => setCopied(true))}
            className="mt-4 w-full rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700"
          >
            {copied ? "Kopiert ✓ – jetzt in Claude einfügen" : "📋 Für Claude kopieren"}
          </button>
          <p className="mt-2 text-xs text-neutral-500">
            Kopiert eine fertige Anleitung mit allen Infos (und dem KI-Text, falls erstellt) für den ersten Wurf in Claude.
          </p>
        </section>
      )}
      {canDelete && (
        <button onClick={remove} disabled={busy} className="w-full text-center text-sm text-neutral-400 hover:text-sdg-red">
          Briefing löschen
        </button>
      )}
    </aside>
  );
}

/** KI-Text: erstellen, ansehen (mit Google-Vorschau) und kopieren. */
export function BriefingText({ id, initial, isAdmin }: { id: string; initial: BriefingAiText | null; isAdmin: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (text && !window.confirm("Den vorhandenen Text durch einen neuen ersetzen?")) return;
    setBusy(true);
    setError(null);
    const res = await generateBriefingText(id).catch(() => ({
      ok: false as const,
      error: "Die KI hat zu lange gebraucht. Bitte erneut versuchen.",
    }));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setText(res.text);
    router.refresh();
  }

  if (!text && !isAdmin) return null;

  return (
    <section className="rounded-3xl border border-white bg-white/90 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">✨ Seitentext (SEO & GEO)</h2>
        <div className="flex gap-2">
          {text && (
            <button
              onClick={() => copy(aiTextToPlain(text), () => setCopied(true))}
              className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              {copied ? "Kopiert ✓" : "Text kopieren"}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={generate}
              disabled={busy}
              className="rounded-full bg-sdg-red px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sdg-red-dark disabled:opacity-60"
            >
              {busy ? "KI schreibt … (bis zu 30 s)" : text ? "Neu erstellen" : "Text erstellen"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-3 rounded-2xl bg-sdg-red-light px-4 py-3 text-sm text-sdg-red-dark">{error}</p>}
      {!text ? (
        <p className="mt-3 text-neutral-500">
          Noch kein Text. Die KI schreibt aus den Produktinfos einen Text, den Google und KI-Suchmaschinen gut finden – mit Meta-Angaben
          und häufigen Fragen. Fehlende Infos markiert sie.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">So könnte es bei Google aussehen</div>
            <div className="mt-2 text-lg leading-snug text-[#1a0dab]">{text.meta_title}</div>
            <div className="mt-1 text-sm text-neutral-600">{text.meta_description}</div>
          </div>
          {text.missing.length > 0 && (
            <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
              <strong>Bitte noch ergänzen:</strong> {text.missing.join(" · ")}
            </div>
          )}
          <article className="space-y-4 text-[15px] leading-relaxed text-neutral-800">
            <h3 className="text-2xl font-bold tracking-tight text-neutral-900">{text.h1}</h3>
            <p>{text.intro}</p>
            {text.sections.map((s) => (
              <div key={s.heading}>
                <h4 className="text-lg font-semibold text-neutral-900">{s.heading}</h4>
                <p className="mt-1">{s.text}</p>
              </div>
            ))}
            <div>
              <h4 className="text-lg font-semibold text-neutral-900">Häufige Fragen</h4>
              <dl className="mt-2 space-y-2">
                {text.faq.map((f) => (
                  <div key={f.question} className="rounded-2xl bg-neutral-50 p-4">
                    <dt className="font-semibold text-neutral-900">{f.question}</dt>
                    <dd className="mt-1">{f.answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </article>
          <div className="flex flex-wrap gap-1.5">
            {text.keywords.map((k) => (
              <span key={k} className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
