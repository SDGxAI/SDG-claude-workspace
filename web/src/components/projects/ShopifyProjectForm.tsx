"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createShopifyProject,
  listShopifyTemplatesFor,
  listShopifyThemesFor,
  type ShopifyConnectionInfo,
} from "@/lib/actions/shopify";
import { guessTemplateForPath, themeRoleLabel } from "@/lib/shopify/paths";

const INPUT =
  "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 disabled:bg-neutral-50";

interface Theme {
  id: string;
  name: string;
  role: string;
}

export function ShopifyProjectForm({
  brands,
  connections,
}: {
  brands: string[];
  connections: ShopifyConnectionInfo[];
}) {
  const router = useRouter();
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeId, setThemeId] = useState("");
  const [templates, setTemplates] = useState<string[]>([]);
  const [template, setTemplate] = useState("");
  const [path, setPath] = useState("/");
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState(brands[0] ?? "");
  const [loadingThemes, setLoadingThemes] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Themes des gewählten Shops laden.
  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    setLoadingThemes(true);
    setError(null);
    setThemes([]);
    setThemeId("");
    listShopifyThemesFor(connectionId).then((res) => {
      if (cancelled) return;
      setLoadingThemes(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setThemes(res.themes);
      const firstPreview = res.themes.find((t) => t.role !== "MAIN") ?? res.themes[0];
      if (firstPreview) setThemeId(firstPreview.id);
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  // Vorlagen des gewählten Themes laden.
  useEffect(() => {
    if (!connectionId || !themeId) return;
    let cancelled = false;
    setLoadingTemplates(true);
    setTemplates([]);
    listShopifyTemplatesFor(connectionId, themeId).then((res) => {
      if (cancelled) return;
      setLoadingTemplates(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTemplates(res.templates);
      setTemplate(guessTemplateForPath(path, res.templates) ?? "");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, themeId]);

  function changePath(value: string) {
    setPath(value);
    const guess = guessTemplateForPath(value, templates);
    if (guess) setTemplate(guess);
  }

  const selectedTheme = themes.find((t) => t.id === themeId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTheme) return;
    if (
      selectedTheme.role === "MAIN" &&
      !window.confirm(
        "Das ist das LIVE-Theme. KI-Änderungen wären sofort für Kund:innen sichtbar. Trotzdem verwenden?",
      )
    )
      return;
    setSaving(true);
    setError(null);
    const res = await createShopifyProject({
      title: title || selectedTheme.name,
      brand,
      connectionId,
      themeId,
      themeName: selectedTheme.name,
      path,
      template,
    });
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return;
    }
    router.push(`/projects/${res.projectId}`);
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
        Es ist noch kein Shopify-Shop verbunden.{" "}
        <Link href="/admin/shopify" className="font-medium text-sdg-red hover:underline">
          Jetzt Shop verbinden →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-neutral-200 bg-white p-6">
      {error && (
        <p className="mb-4 rounded-lg bg-sdg-red-light px-3 py-2 text-sm text-sdg-red-dark">{error}</p>
      )}

      <label className="block text-sm font-medium text-neutral-700">
        Shop
        <select className={INPUT} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.shopDomain})
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block text-sm font-medium text-neutral-700">
        Theme
        <select
          className={INPUT}
          value={themeId}
          onChange={(e) => setThemeId(e.target.value)}
          disabled={loadingThemes || themes.length === 0}
        >
          {loadingThemes && <option>Themes werden geladen …</option>}
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} – {themeRoleLabel(t.role)}
            </option>
          ))}
        </select>
      </label>
      {selectedTheme?.role === "MAIN" && (
        <p className="mt-1 text-xs text-sdg-red-dark">
          Achtung: Das ist das Live-Theme. Für Feedback besser ein nicht veröffentlichtes Theme wählen.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-neutral-700">
          Seite im Shop
          <input
            className={INPUT}
            value={path}
            onChange={(e) => changePath(e.target.value)}
            placeholder="/ oder /products/produkt-handle"
          />
          <span className="mt-1 block text-xs font-normal text-neutral-500">
            „/“ = Startseite. Für andere Seiten den Pfad aus der Shop-Adresse kopieren.
          </span>
        </label>
        <label className="block text-sm font-medium text-neutral-700">
          Vorlage (Theme-Datei)
          <select
            className={INPUT}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={loadingTemplates || templates.length === 0}
          >
            {loadingTemplates && <option>Vorlagen werden geladen …</option>}
            {templates.map((t) => (
              <option key={t} value={t}>
                {t.replace(/^templates\//, "")}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-neutral-500">
            Hier nimmt die KI ihre Änderungen vor. Wird passend zur Seite vorausgewählt.
          </span>
        </label>
      </div>

      <label className="mt-4 block text-sm font-medium text-neutral-700">
        Projekttitel
        <input
          className={INPUT}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={selectedTheme ? `${selectedTheme.name} – Startseite` : "z. B. Simba DE – Startseite"}
        />
      </label>

      <label className="mt-4 block text-sm font-medium text-neutral-700">
        Marke
        <select className={INPUT} value={brand} onChange={(e) => setBrand(e.target.value)}>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={saving || !themeId || !template}
        className="mt-6 w-full rounded-lg bg-sdg-red px-4 py-2.5 font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {saving ? "Vorschau wird aus Shopify geladen …" : "Projekt aus Shopify anlegen"}
      </button>
    </form>
  );
}
