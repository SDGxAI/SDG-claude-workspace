import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { NewProjectChooser } from "@/components/projects/NewProjectChooser";
import { PageContainer } from "@/components/PageContainer";
import { SDG_BRANDS } from "@/lib/brands";
import { listShopifyConnections, type ShopifyConnectionInfo } from "@/lib/actions/shopify";

export const dynamic = "force-dynamic";
// Anlegen aus Shopify lädt die Vorschau aus dem Shop.
export const maxDuration = 60;

export default async function NewProjectPage() {
  const me = await getCurrentProfile();
  if (!me) {
    redirect("/login");
  }

  let connections: ShopifyConnectionInfo[] = [];
  if (me.is_admin) {
    const res = await listShopifyConnections();
    if (res.ok) connections = res.connections;
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-neutral-900">Neues Projekt</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {me.is_admin
          ? "Lade eine fertige HTML-Landingpage hoch oder verbinde ein Vorschau-Theme aus Shopify."
          : "Lade eine fertige HTML-Landingpage hoch. Die App erkennt automatisch die editierbaren Farben, Texte und Bilder."}
      </p>
      <div className="mt-6">
        <NewProjectChooser
          brands={[...SDG_BRANDS]}
          isAdmin={me.is_admin}
          connections={connections}
        />
      </div>
      </div>
    </PageContainer>
  );
}
