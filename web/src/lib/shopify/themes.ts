import "server-only";
import { shopifyGraphql, type Fail, type Ok, type ShopifyConnection } from "@/lib/shopify/client";
import { themeGid } from "@/lib/shopify/paths";
import type { ShopifyFileMap } from "@/types/database";

export interface ShopifyTheme {
  id: string;
  name: string;
  role: string;
  processing: boolean;
}

/** Name des Shops – dient als Verbindungstest. */
export async function fetchShopName(
  conn: ShopifyConnection,
): Promise<Ok<{ name: string }> | Fail> {
  const res = await shopifyGraphql<{ shop: { name: string } }>(
    conn,
    `query SitesShop { shop { name myshopifyDomain primaryDomain { url } } }`,
  );
  if (!res.ok) return res;
  return { ok: true, name: res.data.shop.name };
}

/** Alle Themes eines Shops (Live-Theme zuletzt). */
export async function listThemes(
  conn: ShopifyConnection,
): Promise<Ok<{ themes: ShopifyTheme[] }> | Fail> {
  const res = await shopifyGraphql<{ themes: { nodes: ShopifyTheme[] } }>(
    conn,
    `query SitesThemes { themes(first: 50) { nodes { id name role processing updatedAt } } }`,
  );
  if (!res.ok) return res;
  const themes = [...res.data.themes.nodes].sort((a, b) => {
    if (a.role === "MAIN" && b.role !== "MAIN") return 1;
    if (b.role === "MAIN" && a.role !== "MAIN") return -1;
    return a.name.localeCompare(b.name, "de");
  });
  return { ok: true, themes };
}

/** Dateinamen + Größe passend zu Mustern (z. B. "templates/*.json"). */
export async function listThemeFiles(
  conn: ShopifyConnection,
  themeId: string,
  patterns: string[],
): Promise<Ok<{ files: { filename: string; size: number }[] }> | Fail> {
  const res = await shopifyGraphql<{
    theme: { files: { nodes: { filename: string; size: string | number }[] } | null } | null;
  }>(
    conn,
    `query SitesThemeJsonList($id: ID!, $names: [String!]) {
      theme(id: $id) { id name role files(filenames: $names, first: 250) { nodes { filename size } } }
    }`,
    { id: themeGid(themeId), names: patterns },
  );
  if (!res.ok) return res;
  if (!res.data.theme) return { ok: false, error: "Das Theme wurde im Shop nicht gefunden." };
  return {
    ok: true,
    files: (res.data.theme.files?.nodes ?? []).map((f) => ({
      filename: f.filename,
      size: Number(f.size) || 0,
    })),
  };
}

type FileBody =
  | { __typename: "OnlineStoreThemeFileBodyText"; content: string }
  | { __typename: "OnlineStoreThemeFileBodyBase64"; contentBase64: string }
  | { __typename: "OnlineStoreThemeFileBodyUrl"; url: string };

/** Inhalte von Text-Dateien eines Themes lesen (max. 50 je Anfrage). */
export async function readThemeFiles(
  conn: ShopifyConnection,
  themeId: string,
  filenames: string[],
): Promise<Ok<{ files: ShopifyFileMap }> | Fail> {
  const files: ShopifyFileMap = {};
  for (let i = 0; i < filenames.length; i += 50) {
    const chunk = filenames.slice(i, i + 50);
    const res = await shopifyGraphql<{
      theme: {
        files: { nodes: { filename: string; body: FileBody }[] } | null;
      } | null;
    }>(
      conn,
      `query SitesThemeFiles($id: ID!, $names: [String!]) {
        theme(id: $id) {
          files(filenames: $names, first: 50) {
            nodes {
              filename size
              body {
                __typename
                ... on OnlineStoreThemeFileBodyText { content }
                ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
                ... on OnlineStoreThemeFileBodyUrl { url }
              }
            }
            userErrors { code filename }
          }
        }
      }`,
      { id: themeGid(themeId), names: chunk },
    );
    if (!res.ok) return res;
    if (!res.data.theme) return { ok: false, error: "Das Theme wurde im Shop nicht gefunden." };
    for (const node of res.data.theme.files?.nodes ?? []) {
      const b = node.body;
      if (b.__typename === "OnlineStoreThemeFileBodyText") {
        files[node.filename] = b.content;
      } else if (b.__typename === "OnlineStoreThemeFileBodyBase64") {
        files[node.filename] = Buffer.from(b.contentBase64, "base64").toString("utf8");
      }
    }
  }
  return { ok: true, files };
}

/**
 * Schreibt Text-Dateien ins Theme und wartet kurz, bis Shopify sie
 * verarbeitet hat. Bei Fehlern liefert Shopify verständliche Gründe
 * (z. B. ungültige Einstellung) – die reichen wir weiter.
 */
export async function upsertThemeFiles(
  conn: ShopifyConnection,
  themeId: string,
  files: ShopifyFileMap,
): Promise<Ok<object> | Fail> {
  const entries = Object.entries(files);
  if (entries.length === 0) return { ok: true };

  for (let i = 0; i < entries.length; i += 50) {
    const chunk = entries.slice(i, i + 50);
    const res = await shopifyGraphql<{
      themeFilesUpsert: {
        upsertedThemeFiles: { filename: string }[] | null;
        job: { id: string; done: boolean } | null;
        userErrors: { field?: string[]; message: string; code?: string; filename?: string }[];
      };
    }>(
      conn,
      `mutation SitesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles { filename }
          job { id done }
          userErrors { field message code filename }
        }
      }`,
      {
        themeId: themeGid(themeId),
        files: chunk.map(([filename, value]) => ({
          filename,
          body: { type: "TEXT", value },
        })),
      },
    );
    if (!res.ok) return res;
    const payload = res.data.themeFilesUpsert;
    if (payload.userErrors?.length) {
      const msg = payload.userErrors
        .map((e) => `${e.filename ? `${e.filename}: ` : ""}${e.message}`)
        .join(" · ");
      return { ok: false, error: `Shopify hat die Änderung abgelehnt: ${msg}` };
    }
    if (payload.job && !payload.job.done) {
      await waitForJob(conn, payload.job.id);
    }
  }
  return { ok: true };
}

async function waitForJob(conn: ShopifyConnection, jobId: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const res = await shopifyGraphql<{ job: { done: boolean } | null }>(
      conn,
      `query SitesJob($id: ID!) { job(id: $id) { id done } }`,
      { id: jobId },
    );
    if (!res.ok || !res.data.job || res.data.job.done) return;
  }
}

/**
 * Lädt ein Bild (öffentliche URL) in die Shopify-Dateien und liefert die
 * Referenz, die Theme-Einstellungen erwarten: „shopify://shop_images/<name>“.
 */
export async function createShopImage(
  conn: ShopifyConnection,
  url: string,
  alt: string,
): Promise<Ok<{ ref: string }> | Fail> {
  const ext = (/\.(png|jpe?g|gif|webp|svg|avif)(?:$|\?)/i.exec(url)?.[1] ?? "jpg").toLowerCase();
  const filename = `sites-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await shopifyGraphql<{
    fileCreate: {
      files: { id: string; fileStatus: string; image?: { url: string } | null }[] | null;
      userErrors: { message: string }[];
    };
  }>(
    conn,
    `mutation SitesFileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus alt ... on MediaImage { image { url } } }
        userErrors { field message code }
      }
    }`,
    { files: [{ originalSource: url, contentType: "IMAGE", filename, alt: alt.slice(0, 120) }] },
  );
  if (!res.ok) return res;
  const payload = res.data.fileCreate;
  if (payload.userErrors?.length || !payload.files?.[0]) {
    return {
      ok: false,
      error: `Bild konnte nicht zu Shopify hochgeladen werden: ${payload.userErrors.map((e) => e.message).join(" · ") || "unbekannt"}`,
    };
  }

  // Shopify verarbeitet Bilder asynchron – kurz warten, bis es bereit ist.
  const fileId = payload.files[0].id;
  let imageUrl = payload.files[0].image?.url ?? null;
  for (let i = 0; i < 12 && !imageUrl; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await shopifyGraphql<{
      node: { fileStatus?: string; image?: { url: string } | null } | null;
    }>(
      conn,
      `query SitesFileStatus($id: ID!) { node(id: $id) { ... on MediaImage { id fileStatus image { url } } } }`,
      { id: fileId },
    );
    if (!st.ok) break;
    if (st.data.node?.fileStatus === "FAILED") {
      return { ok: false, error: "Shopify konnte das Bild nicht verarbeiten." };
    }
    imageUrl = st.data.node?.image?.url ?? null;
  }

  // Dateiname aus der CDN-URL (Shopify hängt ggf. eine Kennung an).
  const finalName = imageUrl
    ? decodeURIComponent(imageUrl.split("?")[0].split("/").pop() ?? filename)
    : filename;
  return { ok: true, ref: `shopify://shop_images/${finalName}` };
}
