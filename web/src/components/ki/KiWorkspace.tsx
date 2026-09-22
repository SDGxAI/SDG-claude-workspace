"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  sendDraftInstruction,
  discardDraft,
  commitDraft,
  refreshDraftHtml,
} from "@/lib/actions/draft";
import { uploadKiAsset } from "@/lib/actions/upload";
import { withBlankLinks } from "@/lib/html/previewLinks";
import type { DraftMessage } from "@/types/database";

export interface KiComment {
  id: string;
  body: string;
  authorEmail: string;
}

export interface ModelOption {
  id: string;
  label: string;
}
const MODEL_STORAGE_KEY = "sdg-ki-model";

/** Denkstufe (erweitertes Nachdenken der KI). */
const EFFORT_OPTIONS: { id: "standard" | "mittel" | "hoch"; label: string }[] = [
  { id: "standard", label: "Aufwand: Standard" },
  { id: "mittel", label: "Aufwand: Mittel" },
  { id: "hoch", label: "Aufwand: Hoch" },
];
const EFFORT_STORAGE_KEY = "sdg-ki-effort";
type Effort = "standard" | "mittel" | "hoch";


/**
 * Vollbild-Arbeitsbereich „Mit KI bearbeiten": links Live-Vorschau des
 * Entwurfs, rechts Chat + Kommentar-Auswahl. Man iteriert beliebig oft; erst
 * „Als neue Version speichern" macht daraus eine Version.
 */
export function KiWorkspace({
  projectId,
  pageId,
  projectTitle,
  initialHtml,
  initialMessages,
  openComments,
  models,
}: {
  projectId: string;
  pageId: string;
  projectTitle: string;
  initialHtml: string;
  initialMessages: DraftMessage[];
  openComments: KiComment[];
  models: ModelOption[];
}) {
  const router = useRouter();
  const [html, setHtml] = useState(initialHtml);
  const [messages, setMessages] = useState<DraftMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [assets, setAssets] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Nur-Ansicht: Desktop- oder Mobil-Darstellung des Entwurfs (kein Speichern).
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  // Gewähltes Claude-Modell + Denkstufe (in diesem Browser gemerkt).
  const [model, setModel] = useState<string>(models[0]?.id ?? "");
  const [effort, setEffort] = useState<Effort>("standard");

  useEffect(() => {
    try {
      const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
      if (savedModel && models.some((m) => m.id === savedModel))
        setModel(savedModel);
      const savedEffort = localStorage.getItem(EFFORT_STORAGE_KEY);
      if (savedEffort && EFFORT_OPTIONS.some((e) => e.id === savedEffort))
        setEffort(savedEffort as Effort);
    } catch {
      /* localStorage nicht verfügbar */
    }
  }, [models]);

  function chooseModel(id: string) {
    setModel(id);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  function chooseEffort(id: Effort) {
    setEffort(id);
    try {
      localStorage.setItem(EFFORT_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  const remaining = openComments.filter((c) => !applied.has(c.id));

  async function uploadFile(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadKiAsset(projectId, fd);
    setUploading(false);
    if (res.ok) {
      setAssets((prev) => [...prev, res.url]);
    } else {
      window.alert(res.error);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await uploadFile(file);
  }

  // Screenshots/Bilder direkt per Einfügen (Strg/⌘+V) übernehmen – egal wo
  // im KI-Bereich. Nur Bilder aus der Zwischenablage werden hochgeladen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void uploadFile(file);
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function syncPreview() {
    const res = await refreshDraftHtml(pageId, projectId);
    if (res.ok) setHtml(res.html);
    return res.ok;
  }

  async function send() {
    const ids = [...checked];
    if (!text.trim() && ids.length === 0 && assets.length === 0) return;
    setBusy(true);
    try {
      const res = await sendDraftInstruction(
        pageId,
        projectId,
        text,
        ids,
        assets,
        model,
        effort,
      );
      if (res.ok) {
        setHtml(res.draft.html);
        setMessages(res.draft.messages);
        setText("");
        setApplied((prev) => new Set([...prev, ...ids]));
        setChecked(new Set());
        setAssets([]);
      } else {
        window.alert(res.error);
      }
    } catch {
      // Antwort ging verloren (z. B. lange Rechenzeit) – Entwurf trotzdem
      // nachladen, die Änderung wurde meist schon gespeichert.
      const ok = await syncPreview();
      window.alert(
        ok
          ? "Die KI hat etwas länger gebraucht – die Vorschau wurde aktualisiert. Bitte prüfe das Ergebnis."
          : "Die Antwort kam nicht rechtzeitig an. Klicke „Vorschau aktualisieren“ oder versuche es erneut.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Kommt man ins Fenster zurück, den Entwurf leise nachziehen (falls eine
  // Antwort im Hintergrund fertig wurde).
  useEffect(() => {
    const onFocus = () => {
      if (!busy) void syncPreview();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pageId, projectId]);

  async function save() {
    setCommitting(true);
    const res = await commitDraft(pageId, projectId, [...applied]);
    setCommitting(false);
    if (res.ok) {
      router.push(`/projects/${projectId}`);
      router.refresh();
    } else {
      window.alert(res.error);
    }
  }

  async function discard() {
    if (
      !window.confirm(
        "Entwurf verwerfen? Alle Änderungen in diesem KI-Bearbeiten-Verlauf gehen verloren (die gespeicherten Versionen bleiben unberührt).",
      )
    )
      return;
    setCommitting(true);
    const res = await discardDraft(pageId, projectId);
    setCommitting(false);
    if (res.ok) {
      router.push(`/projects/${projectId}`);
      router.refresh();
    } else {
      window.alert(res.error);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}`}
            className="text-sm text-neutral-500 hover:text-sdg-red"
          >
            ← Zurück
          </Link>
          <span className="text-sm font-semibold text-neutral-900">
            ✏️ Mit KI bearbeiten – {projectTitle}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={discard}
            disabled={committing || busy}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
          >
            Verwerfen
          </button>
          <button
            onClick={save}
            disabled={committing || busy}
            className="rounded-lg bg-sdg-red px-4 py-1.5 text-sm font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
          >
            {committing ? "Speichert …" : "Als neue Version speichern"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Live-Vorschau des Entwurfs */}
        <div className="flex min-h-0 flex-1 flex-col bg-neutral-100">
          {/* Ansicht umschalten (nur zum Schauen) + Vorschau nachladen */}
          <div className="flex items-center justify-center gap-2 p-2">
            <button
              type="button"
              onClick={() => void syncPreview()}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-600 hover:border-sdg-red hover:text-sdg-red"
              title="Neuesten Entwurf-Stand laden"
            >
              🔄 Vorschau aktualisieren
            </button>
            <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 bg-white">
              {(
                [
                  ["desktop", "🖥 Desktop"],
                  ["mobile", "📱 Mobil"],
                ] as const
              ).map(([key, label], i) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  className={`px-3 py-1 text-sm font-medium transition-colors ${
                    i > 0 ? "border-l border-neutral-300" : ""
                  } ${
                    view === key
                      ? "bg-sdg-red text-white"
                      : "bg-white text-neutral-600 hover:text-sdg-red"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            <div
              className={
                view === "mobile"
                  ? "mx-auto h-full w-full max-w-[400px] overflow-hidden rounded-[2rem] border-[10px] border-neutral-800 bg-white shadow-xl"
                  : "h-full w-full overflow-hidden rounded-lg border border-neutral-200 bg-white"
              }
            >
              <iframe
                title="Entwurf-Vorschau"
                srcDoc={withBlankLinks(html)}
                className="h-full min-h-[50vh] w-full bg-white"
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              />
            </div>
          </div>
        </div>

        {/* Chat + Kommentar-Auswahl */}
        <div className="flex min-h-0 w-full flex-col border-t border-neutral-200 bg-white lg:w-[26rem] lg:border-l lg:border-t-0">
          {/* Verlauf */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <p className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600">
              Schreib der KI, was geändert werden soll – so oft du willst. Du
              kannst auch offene Kommentare unten auswählen, Bilder hochladen
              oder einen Screenshot direkt einfügen (Strg/⌘+V). Nichts wird
              gespeichert, bis du oben auf „Als neue Version speichern“ klickst.
            </p>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 text-sm ${
                  m.role === "user"
                    ? "bg-sdg-red-light text-neutral-800"
                    : "bg-neutral-100 text-neutral-600"
                }`}
              >
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                  {m.role === "user" ? "Du" : "KI"}
                </div>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
            {busy && (
              <div className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-500">
                KI arbeitet …
              </div>
            )}
          </div>

          {/* Kommentar-Auswahl */}
          {remaining.length > 0 && (
            <div className="max-h-48 overflow-y-auto border-t border-neutral-100 p-3">
              <div className="mb-2 text-xs font-medium text-neutral-500">
                Offene Kommentare übernehmen
              </div>
              <ul className="space-y-1">
                {remaining.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded p-1 text-sm hover:bg-neutral-50">
                      <input
                        type="checkbox"
                        checked={checked.has(c.id)}
                        onChange={() => toggle(c.id)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-neutral-800">
                          {c.body}
                        </span>
                        <span className="block text-[10px] text-neutral-400">
                          {c.authorEmail}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {applied.size > 0 && (
            <div className="border-t border-neutral-100 px-3 py-2 text-xs text-green-700">
              ✓ {applied.size} Kommentar(e) übernommen – werden beim Speichern
              als erledigt markiert.
            </div>
          )}

          {/* Hochgeladene Bilder */}
          {assets.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-neutral-100 px-3 py-2">
              {assets.map((url, i) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Bild ${i + 1}`}
                    className="h-12 w-12 rounded border border-neutral-200 object-cover"
                  />
                  <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800 text-[9px] font-bold text-white">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAssets((prev) => prev.filter((u) => u !== url))
                    }
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] text-neutral-500 shadow hover:text-sdg-red"
                    title="Entfernen"
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="self-center text-[11px] text-neutral-400">
                In der Anweisung z. B. „füge Bild 1 oben ein“.
              </span>
            </div>
          )}

          {/* Eingabe */}
          <div className="border-t border-neutral-200 p-3">
            <textarea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              placeholder={'Was soll geändert werden? (z. B. „Ersetze das Hero-Bild durch …", „mach die Überschrift kürzer")'}
              className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:border-sdg-red hover:text-sdg-red">
                  {uploading ? "Lädt …" : "📷 Bild"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={handleUpload}
                  />
                </label>
                <select
                  value={model}
                  onChange={(e) => chooseModel(e.target.value)}
                  className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 outline-none focus:border-sdg-red"
                  title="Genaues KI-Modell wählen – gründlichere Modelle brauchen länger"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  value={effort}
                  onChange={(e) => chooseEffort(e.target.value as Effort)}
                  className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 outline-none focus:border-sdg-red"
                  title="Denkstufe – höher = gründlicher, aber langsamer"
                >
                  {EFFORT_OPTIONS.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-neutral-400">
                  Strg/⌘ + Enter
                </span>
                <button
                  onClick={send}
                  disabled={
                    busy ||
                    (!text.trim() && checked.size === 0 && assets.length === 0)
                  }
                  className="rounded-lg bg-neutral-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {busy ? "…" : "Senden"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
