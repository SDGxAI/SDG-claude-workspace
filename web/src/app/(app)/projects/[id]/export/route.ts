import { NextResponse, type NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanHtml } from "@/lib/page/html";
import { loadPage } from "@/lib/page/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adressen von Bildern im Sites-Bilderspeicher. */
const ASSET_URL_RE = /https?:\/\/[^"'()\s<>]+\/storage\/v1\/object\/public\/ki-assets\/[^"'()\s<>?#]+/g;

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}

/**
 * Export einer Seite als eigenständige Datei:
 * - format=html: eine .html-Datei, Bilder als Base64 eingebettet
 * - format=zip:  ZIP mit index.html + images/-Ordner (relative Pfade)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "zip" ? "zip" : "html";

  const access = await getProjectAccess(id);
  if (!access || !access.canEdit) {
    return NextResponse.json({ error: "Kein Zugriff." }, { status: 403 });
  }

  const supabase = await createClient();
  const [{ data: project }, page] = await Promise.all([
    supabase.from("projects").select("title").eq("id", id).single(),
    loadPage(id),
  ]);
  if (!project || !page) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  const baseName = sanitizeFilename(project.title);
  const source = cleanHtml(page.html);

  // Bilder aus dem Sites-Bilderspeicher wieder in die Datei holen.
  const admin = createAdminClient();
  const urls = [...new Set(source.match(ASSET_URL_RE) ?? [])];
  const images = new Map<string, { bytes: Uint8Array; mime: string; ext: string }>();
  await Promise.all(
    urls.map(async (url) => {
      const path = decodeURIComponent(url.split("/ki-assets/")[1] ?? "");
      const { data } = await admin.storage.from("ki-assets").download(path);
      if (!data) return;
      const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase() ?? "png";
      images.set(url, {
        bytes: new Uint8Array(await data.arrayBuffer()),
        mime: data.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
        ext,
      });
    }),
  );

  if (format === "html") {
    const html = source.replace(ASSET_URL_RE, (url) => {
      const img = images.get(url);
      return img ? `data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}` : url;
    });
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.html"`,
      },
    });
  }

  // ZIP mit relativen Bildpfaden
  const zip = new JSZip();
  const names = new Map<string, string>();
  for (const [url, img] of images) {
    const name = `images/bild-${names.size + 1}.${img.ext}`;
    names.set(url, name);
    zip.file(name, img.bytes);
  }
  zip.file("index.html", source.replace(ASSET_URL_RE, (url) => names.get(url) ?? url));
  const zipBytes = await zip.generateAsync({ type: "uint8array" });

  // Cast wegen TS-Typreibung zwischen Uint8Array<ArrayBufferLike> und
  // BodyInit; zur Laufzeit akzeptiert NextResponse ein Uint8Array.
  return new NextResponse(zipBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${baseName}.zip"`,
    },
  });
}
