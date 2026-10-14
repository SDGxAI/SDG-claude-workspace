import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { PageContainer } from "@/components/PageContainer";
import { ShopifyConnections } from "@/components/admin/ShopifyConnections";
import { listShopifyConnections } from "@/lib/actions/shopify";
import { oauthAppUrl, oauthCallbackUrl } from "@/lib/shopify/oauth";

export const dynamic = "force-dynamic";
// Verbindungstest ruft Shopify mehrfach auf.
export const maxDuration = 60;

export default async function AdminShopifyPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
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

      {connected && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          ✓ Verbunden mit „{connected}“. Du kannst jetzt unter „Neues Projekt“ → „Shopify-Theme“ ein
          Projekt anlegen.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-sdg-red-light px-4 py-3 text-sm text-sdg-red-dark">{error}</p>
      )}

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
            Neue <strong>Version</strong> anlegen mit:
            <ul className="ml-5 mt-1 list-disc space-y-1">
              <li>
                App-URL: <code className="rounded bg-neutral-100 px-1">{oauthAppUrl()}</code>
              </li>
              <li>„App in Shopify-Adminbereich einbetten“: <strong>aus</strong></li>
              <li>
                Zulässige Weiterleitungs-URL:{" "}
                <code className="rounded bg-neutral-100 px-1">{oauthCallbackUrl()}</code>
              </li>
              <li>
                Bereiche: <code className="rounded bg-neutral-100 px-1">read_themes,write_themes,write_files</code>
              </li>
            </ul>
            … und veröffentlichen.
          </li>
          <li>
            In der App unter <strong>Einstellungen</strong> die <strong>Client-ID</strong> und das{" "}
            <strong>Client-Secret</strong> kopieren und hier eintragen (nicht per Mail oder Chat
            verschicken).
          </li>
          <li>
            Auf <strong>„Über Shopify freigeben ↗“</strong> klicken, in Shopify die Installation
            bestätigen – du landest automatisch wieder hier.
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
