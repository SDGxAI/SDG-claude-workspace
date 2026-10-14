import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { PageContainer } from "@/components/PageContainer";
import { ShopifyConnections } from "@/components/admin/ShopifyConnections";
import { listShopifyConnections } from "@/lib/actions/shopify";

export const dynamic = "force-dynamic";
// Verbindungstest ruft Shopify mehrfach auf.
export const maxDuration = 60;

export default async function AdminShopifyPage() {
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  if (!me.is_admin) redirect("/projects");

  const res = await listShopifyConnections();

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold text-neutral-900">Shopify-Shops</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Verbinde Shopify-Shops, um Vorschau-Themes in Sites zu kommentieren und per KI direkt in
        Shopify zu ändern. Neue Projekte legst du danach unter „Neues Projekt“ → „Shopify-Theme“ an.
      </p>

      <details className="mt-4 rounded-xl border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
        <summary className="cursor-pointer font-medium text-neutral-900">
          Anleitung: Zugang in Shopify einrichten (einmalig je Shop)
        </summary>
        <ol className="mt-3 list-inside list-decimal space-y-2">
          <li>
            Im <strong>Shopify Dev Dashboard</strong> (dev.shopify.com) eine App anlegen, z. B.
            „SDG Sites“. Eine App reicht für alle Shops eurer Organisation.
          </li>
          <li>
            Unter <strong>Versionen → Zugriffsbereiche (Scopes)</strong> auswählen:{" "}
            <code className="rounded bg-neutral-100 px-1">read_themes</code>,{" "}
            <code className="rounded bg-neutral-100 px-1">write_themes</code>,{" "}
            <code className="rounded bg-neutral-100 px-1">write_files</code> – Version freigeben.
          </li>
          <li>Die App im jeweiligen Shop <strong>installieren</strong>.</li>
          <li>
            In der App unter <strong>Einstellungen</strong> die <strong>Client-ID</strong> und das{" "}
            <strong>Client-Secret</strong> kopieren und hier eintragen (nicht per Mail oder Chat
            verschicken).
          </li>
          <li>
            Ist der Shop noch nicht live, das <strong>Onlineshop-Passwort</strong> (Onlineshop →
            Einstellungen → Passwortschutz) mit eintragen, damit Sites die Vorschau laden kann.
          </li>
        </ol>
        <p className="mt-3 text-neutral-500">
          Ältere, direkt im Shopify-Admin angelegte Apps funktionieren weiterhin – dann statt
          Client-ID/Secret das Admin-API-Zugriffstoken (beginnt mit „shpat_“) eintragen.
        </p>
      </details>

      {res.ok ? (
        <ShopifyConnections connections={res.connections} />
      ) : (
        <p className="mt-6 rounded-lg bg-sdg-red-light px-4 py-3 text-sm text-sdg-red-dark">
          {res.error}
        </p>
      )}
    </PageContainer>
  );
}
