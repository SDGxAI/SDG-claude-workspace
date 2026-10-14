"use client";

import { useState } from "react";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
import { ShopifyProjectForm } from "@/components/projects/ShopifyProjectForm";
import type { ShopifyConnectionInfo } from "@/lib/actions/shopify";

/** Admins wählen, ob das Projekt aus einer HTML-Datei oder aus Shopify kommt. */
export function NewProjectChooser({
  brands,
  isAdmin,
  connections,
}: {
  brands: string[];
  isAdmin: boolean;
  connections: ShopifyConnectionInfo[];
}) {
  const [source, setSource] = useState<"file" | "shopify">("file");

  if (!isAdmin) return <NewProjectForm brands={brands} />;

  const tab = (value: "file" | "shopify", label: string) => (
    <button
      type="button"
      onClick={() => setSource(value)}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        source === value
          ? "bg-white text-sdg-red shadow-sm"
          : "text-neutral-600 hover:text-sdg-red"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-xl bg-neutral-100 p-1">
        {tab("file", "📄 HTML-Datei")}
        {tab("shopify", "🛍️ Shopify-Theme")}
      </div>
      {source === "file" ? (
        <NewProjectForm brands={brands} />
      ) : (
        <ShopifyProjectForm brands={brands} connections={connections} />
      )}
    </div>
  );
}
