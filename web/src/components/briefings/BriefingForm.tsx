"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { prepareBriefingUpload, submitBriefing } from "@/lib/actions/briefings";
import { BRIEFING_MAX_BYTES, formatBytes } from "@/lib/briefing";
import type { BriefingFile } from "@/types/database";

interface Upload {
  key: string;
  file: File;
  preview: string | null;
  state: "laedt" | "fertig" | "fehler";
  error?: string;
  stored?: BriefingFile;
}

/** Schnellauswahl für „Was ist dir wichtig?“. */
const PRIORITIES = [
  "Mehr Verkäufe",
  "Marke bekannter machen",
  "Große, emotionale Bilder",
  "Viele Produktinfos",
  "Saison- oder Aktionsseite",
  "Gut auf dem Handy",
];

const input =
  "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-sdg-red focus:ring-4 focus:ring-sdg-red/10";

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white bg-white/90 p-6 shadow-sm sm:p-7">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sdg-red to-rose-400 text-sm font-bold text-white shadow-sm">
          {n}
        </span>
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-neutral-500">{hint}</p>}
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-neutral-700">
        {label}
        {optional && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-normal text-neutral-500">optional</span>}
      </span>
      {children}
    </label>
  );
}

export function BriefingForm({ brands }: { brands: string[] }) {
  const [brand, setBrand] = useState("");
  const [title, setTitle] = useState("");
  const [goLive, setGoLive] = useState("");
  const [productInfo, setProductInfo] = useState("");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [importantNote, setImportantNote] = useState("");
  const [wantsAiText, setWantsAiText] = useState(true);
  const [ownText, setOwnText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [kidsLink, setKidsLink] = useState("");
  const [noKids, setNoKids] = useState(false);
  const [inspiration, setInspiration] = useState<string[]>([""]);
  const [inspirationNote, setInspirationNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const patch = (key: string, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  async function upload(u: Upload) {
    try {
      if (u.file.size > BRIEFING_MAX_BYTES) {
        throw new Error(`Größer als ${formatBytes(BRIEFING_MAX_BYTES)} – bitte per Transferlink schicken.`);
      }
      const type = u.file.type || "application/octet-stream";
      const prep = await prepareBriefingUpload(u.file.name, type, u.file.size);
      if (!prep.ok) throw new Error(prep.error);
      const { error: upErr } = await createClient()
        .storage.from("briefings")
        .uploadToSignedUrl(prep.path, prep.token, u.file, { contentType: type });
      if (upErr) {
        throw new Error(
          /size|large|413/i.test(upErr.message)
            ? "Zu groß für den Speicher – bitte per Transferlink schicken."
            : `Upload fehlgeschlagen (${upErr.message}).`,
        );
      }
      patch(u.key, { state: "fertig", stored: { path: prep.path, name: u.file.name, type, size: u.file.size } });
    } catch (e) {
      patch(u.key, { state: "fehler", error: e instanceof Error ? e.message : "Upload fehlgeschlagen." });
    }
  }

  function addFiles(list: FileList | null) {
    const fresh = [...(list ?? [])]
      .filter((f) => /^(image|video)\//.test(f.type))
      .map((file) => ({
        key: crypto.randomUUID(),
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        state: "laedt" as const,
      }));
    if (list && fresh.length < list.length) setError("Es sind nur Fotos und Videos möglich.");
    setUploads((cur) => [...cur, ...fresh]);
    fresh.forEach((u) => void upload(u));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (uploads.some((u) => u.state === "laedt")) return setError("Bitte warte, bis alle Dateien hochgeladen sind.");
    setSending(true);
    const res = await submitBriefing({
      brand,
      title,
      goLive,
      productInfo,
      important: [priorities.join(" · "), importantNote.trim()].filter(Boolean).join(" – "),
      ownText,
      wantsAiText,
      files: uploads.flatMap((u) => (u.stored ? [u.stored] : [])),
      kidsTransferLink: kidsLink,
      noKidsConfirmed: noKids,
      inspirationUrls: inspiration,
      inspirationNote,
    });
    setSending(false);
    if (!res.ok) return setError(res.error);
    setDone(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done) {
    return (
      <div className="rounded-3xl border border-white bg-white/90 p-10 text-center shadow-lg">
        <div className="text-5xl">🎉</div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-neutral-900">Danke, dein Briefing ist da!</h2>
        <p className="mx-auto mt-2 max-w-md text-neutral-600">
          Wir schauen es uns an und melden uns bei dir. Den Stand siehst du jederzeit unter „Briefings“.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Link href="/briefings" className="rounded-full bg-sdg-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-sdg-red-dark">
            Zu meinen Briefings
          </Link>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            Noch ein Briefing
          </button>
        </div>
      </div>
    );
  }

  const hasFiles = uploads.some((u) => u.state !== "fehler");
  const option = (active: boolean) =>
    `flex-1 rounded-2xl border-2 p-4 text-left transition ${
      active ? "border-sdg-red bg-sdg-red-light/50" : "border-neutral-200 bg-white hover:border-neutral-300"
    }`;

  return (
    <form onSubmit={send} className="space-y-5">
      <Step n={1} title="Worum geht's?">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marke">
            <select required value={brand} onChange={(e) => setBrand(e.target.value)} className={input}>
              <option value="" disabled>
                Bitte wählen …
              </option>
              {brands.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field label="Wunschtermin" optional>
            <input type="date" value={goLive} onChange={(e) => setGoLive(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Produkt oder Aktion">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z. B. BIG Bobby Car Kawaii"
            className={input}
          />
        </Field>
      </Step>

      <Step n={2} title="Dein Produkt" hint="Stichpunkte reichen völlig.">
        <Field label="Infos zum Produkt">
          <textarea
            required
            rows={5}
            value={productInfo}
            onChange={(e) => setProductInfo(e.target.value)}
            placeholder={"Was ist es, was macht es besonders?\nFür welches Alter?\nWichtige Fakten: Maße, Material, Funktionen, Preis …"}
            className={`${input} resize-y`}
          />
        </Field>
        <div>
          <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-neutral-700">
            Was ist dir wichtig?
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-normal text-neutral-500">optional</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => {
              const on = priorities.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPriorities((list) => (on ? list.filter((x) => x !== p) : [...list, p]))}
                  className={`rounded-full border px-3.5 py-2 text-sm transition ${
                    on
                      ? "border-sdg-red bg-sdg-red text-white shadow-sm"
                      : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {p}
                </button>
              );
            })}
          </div>
          <input
            value={importantNote}
            onChange={(e) => setImportantNote(e.target.value)}
            placeholder="Noch etwas? z. B. „Der Weihnachtsbezug soll klar rüberkommen“"
            className={`${input} mt-3`}
          />
        </div>
      </Step>

      <Step n={3} title="Text für die Seite">
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => setWantsAiText(true)} className={option(wantsAiText)}>
            <div className="font-semibold text-neutral-900">✨ Bitte für uns schreiben</div>
            <div className="mt-1 text-sm text-neutral-500">Wir erstellen einen SEO- und GEO-optimierten Text mit KI.</div>
          </button>
          <button type="button" onClick={() => setWantsAiText(false)} className={option(!wantsAiText)}>
            <div className="font-semibold text-neutral-900">📝 Wir haben schon einen Text</div>
            <div className="mt-1 text-sm text-neutral-500">Einfach unten einfügen – wir optimieren ihn auf Wunsch.</div>
          </button>
        </div>
        {!wantsAiText && (
          <textarea
            rows={7}
            value={ownText}
            onChange={(e) => setOwnText(e.target.value)}
            placeholder="Dein Text …"
            className={`${input} resize-y`}
          />
        )}
      </Step>

      <Step n={4} title="Fotos & Videos">
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">⚠️ Bitte keine Fotos oder Videos hochladen, auf denen Kinder zu sehen sind.</p>
          <p className="mt-1 text-sm text-amber-900/80">
            Aufnahmen mit Kindern – und sehr große Dateien über {formatBytes(BRIEFING_MAX_BYTES)} – schickst du uns bitte als
            Transferlink (z. B. WeTransfer):
          </p>
          <input
            value={kidsLink}
            onChange={(e) => setKidsLink(e.target.value)}
            placeholder="Transferlink einfügen, z. B. https://we.tl/…"
            className={`${input} mt-3 border-amber-200`}
          />
        </div>

        <div
          onClick={() => picker.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
            dragging ? "border-sdg-red bg-sdg-red-light/40" : "border-neutral-300 bg-neutral-50/60 hover:border-neutral-400"
          }`}
        >
          <div className="text-3xl">📸</div>
          <p className="mt-2 font-medium text-neutral-800">Fotos & Videos hierher ziehen</p>
          <p className="text-sm text-neutral-500">oder klicken zum Auswählen</p>
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {uploads.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {uploads.map((u) => (
              <li key={u.key} className="group relative overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                <div className="flex aspect-square items-center justify-center bg-neutral-100">
                  {u.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl">🎬</span>
                  )}
                  {u.state === "laedt" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-neutral-700">
                      Lädt hoch …
                    </span>
                  )}
                </div>
                <div className="px-2.5 py-2 text-xs">
                  <div className="truncate font-medium text-neutral-800">{u.file.name}</div>
                  <div className={u.state === "fehler" ? "text-sdg-red" : "text-neutral-400"}>
                    {u.state === "fehler" ? u.error : u.state === "fertig" ? `✓ ${formatBytes(u.file.size)}` : formatBytes(u.file.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-600 shadow-sm hover:text-sdg-red"
                  aria-label="Entfernen"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {hasFiles && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-neutral-50 p-4 text-sm text-neutral-800">
            <input
              type="checkbox"
              required
              checked={noKids}
              onChange={(e) => setNoKids(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-sdg-red"
            />
            <span>
              Ich bestätige: Auf meinen hochgeladenen Fotos und Videos sind <strong>keine Kinder</strong> zu sehen.
            </span>
          </label>
        )}
      </Step>

      <Step n={5} title="Inspiration" hint="Du hast eine Seite gesehen, die dir gefällt? Schick sie uns gern mit.">
        {inspiration.map((url, i) => (
          <input
            key={i}
            value={url}
            onChange={(e) => setInspiration((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
            placeholder="https://…"
            className={input}
          />
        ))}
        {inspiration.length < 3 && (
          <button
            type="button"
            onClick={() => setInspiration((list) => [...list, ""])}
            className="text-sm font-medium text-sdg-red hover:underline"
          >
            + Weitere Seite
          </button>
        )}
        <Field label="Was gefällt dir daran?" optional>
          <input
            value={inspirationNote}
            onChange={(e) => setInspirationNote(e.target.value)}
            placeholder="z. B. die großen Bilder und die lockere Sprache"
            className={input}
          />
        </Field>
      </Step>

      {error && <p className="rounded-2xl bg-sdg-red-light px-4 py-3 text-sm font-medium text-sdg-red-dark">{error}</p>}

      <div className="flex flex-col items-center gap-2 pb-4 pt-2">
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-sdg-red px-8 py-3.5 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sdg-red-dark disabled:opacity-60"
        >
          {sending ? "Wird gesendet …" : "Briefing absenden 🚀"}
        </button>
        <p className="text-xs text-neutral-400">Du kannst den Stand danach jederzeit unter „Briefings“ sehen.</p>
      </div>
    </form>
  );
}
