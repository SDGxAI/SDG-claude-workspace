"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reloadFromShopify } from "@/lib/actions/shopify";

/** Info-Leiste für Projekte aus Shopify: Theme, Vorschau-Link, neu laden. */
export function ShopifyBar({
  projectId,
  shopName,
  themeName,
  path,
  previewUrl,
  canEdit,
}: {
  projectId: string;
  shopName: string;
  themeName: string;
  path: string;
  previewUrl: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setBusy(true);
    setError(null);
    const res = await reloadFromShopify(projectId);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium text-neutral-900">🛍️ Shopify</span>
        <span className="text-neutral-500">
          {shopName} · Theme „{themeName}“ · Seite {path}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red"
            >
              Vorschau in Shopify ↗
            </a>
          )}
          {canEdit && (
            <button
              onClick={reload}
              disabled={busy}
              title="Aktuellen Stand aus Shopify holen (z. B. nach Änderungen im Shopify-Theme-Editor)"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
            >
              {busy ? "Lädt …" : "🔄 Aus Shopify neu laden"}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded-lg bg-sdg-red-light px-3 py-2 text-sdg-red-dark">{error}</p>
      )}
    </div>
  );
}
