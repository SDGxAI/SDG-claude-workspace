"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProject, type CreateProjectResult } from "@/lib/actions/projects";

export function NewProjectForm({ brands }: { brands: string[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState(brands[0] ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<
    Extract<CreateProjectResult, { ok: true }> | null
  >(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      setHtml(null);
      return;
    }
    if (!/\.html?$/i.test(file.name)) {
      setError("Bitte eine .html-Datei auswählen.");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setHtml(text);
    if (!title) {
      setTitle(file.name.replace(/\.html?$/i, ""));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!html || !fileName) {
      setError("Bitte zuerst eine HTML-Datei auswählen.");
      return;
    }
    setLoading(true);
    const result = await createProject({ title, brand, html, filename: fileName });
    if (result.ok) {
      setReport(result);
      router.refresh();
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  if (report) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-neutral-900">
          Import erfolgreich
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Gefunden in „{title}“:
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-neutral-50 p-4">
            <div className="text-2xl font-semibold text-sdg-red">
              {report.counts.colors}
            </div>
            <div className="text-xs text-neutral-500">Farben</div>
          </div>
          <div className="rounded-lg bg-neutral-50 p-4">
            <div className="text-2xl font-semibold text-sdg-red">
              {report.counts.texts}
            </div>
            <div className="text-xs text-neutral-500">Textfelder</div>
          </div>
          <div className="rounded-lg bg-neutral-50 p-4">
            <div className="text-2xl font-semibold text-sdg-red">
              {report.counts.images}
            </div>
            <div className="text-xs text-neutral-500">Bilder</div>
          </div>
        </div>

        {report.warnings.length > 0 && (
          <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-medium">Hinweise zum Import:</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <Link
            href={`/projects/${report.projectId}/editor`}
            className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark"
          >
            Zum Editor
          </Link>
          <Link
            href="/projects"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red"
          >
            Zur Übersicht
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-neutral-200 bg-white p-6"
    >
      {error && (
        <p className="mb-4 rounded-lg bg-sdg-red-light px-3 py-2 text-sm text-sdg-red-dark">
          {error}
        </p>
      )}

      <label className="block text-sm font-medium text-neutral-700">
        HTML-Datei
        <input
          type="file"
          accept=".html,text/html"
          onChange={handleFile}
          className="mt-1 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sdg-red file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-sdg-red-dark"
        />
      </label>
      {fileName && (
        <p className="mt-1 text-xs text-neutral-500">Ausgewählt: {fileName}</p>
      )}

      <label className="mt-4 block text-sm font-medium text-neutral-700">
        Projekttitel
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="z. B. Bloom Spirit Early Access"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
        />
      </label>

      <label className="mt-4 block text-sm font-medium text-neutral-700">
        Marke
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
        >
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={loading || !html}
        className="mt-6 w-full rounded-lg bg-sdg-red px-4 py-2.5 font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {loading ? "Wird analysiert …" : "Projekt anlegen & analysieren"}
      </button>
    </form>
  );
}
