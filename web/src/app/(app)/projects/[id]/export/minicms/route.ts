import { NextResponse, type NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectAccess } from "@/lib/access";
import { cleanHtml } from "@/lib/page/html";
import { loadPage } from "@/lib/page/store";
import { buildMiniCms } from "@/lib/minicms/build";
import { translateUnits, type TranslationCache } from "@/lib/minicms/translate";
import type { Asset } from "@/lib/minicms/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Privater Speicher für fertige Exporte und den Übersetzungs-Zwischenspeicher. */
const BUCKET = "exports";
const MAX_ASSET_BYTES = 15 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

type Admin = ReturnType<typeof createAdminClient>;

async function ensureBucket(admin: Admin) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (!data) await admin.storage.createBucket(BUCKET, { public: false });
}

function extOf(path: string, mime?: string): string {
  return EXT_BY_MIME[(mime ?? "").split(";")[0]] ?? /\.([a-z0-9]{2,4})$/i.exec(path)?.[1].toLowerCase() ?? "png";
}

async function fetchAsset(admin: Admin, url: string): Promise<Asset | null> {
  const dataUri = /^data:([a-z]+\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i.exec(url);
  if (dataUri) {
    const bytes = dataUri[2] ? Buffer.from(dataUri[3], "base64") : Buffer.from(decodeURIComponent(dataUri[3]));
    return { bytes: new Uint8Array(bytes), ext: extOf("", dataUri[1].toLowerCase()) };
  }
  const own = /\/storage\/v1\/object\/public\/([^/]+)\/([^?#]+)/.exec(url);
  if (own) {
    const path = decodeURIComponent(own[2]);
    const { data } = await admin.storage.from(own[1]).download(path);
    if (!data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), ext: extOf(path, data.type) };
  }
  if (!/^https:\/\//i.test(url)) return null;
  // Fremde Bilder (z. B. aus dem Shop) mit übernehmen – nur Bilder/Videos, mit Größenlimit
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !/^(image|video)\//.test(type)) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ASSET_BYTES) return null;
  return { bytes, ext: extOf(new URL(url).pathname, type) };
}

/**
 * Export für das MiniCMS der Agentur: baut aus der Seite ein Projekt im
 * MiniCMS-Format (content.twig/css/js, translations, public/ …), legt es als
 * ZIP im privaten Speicher ab und liefert die Prüfung plus Download-Link.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getProjectAccess(id);
  if (!access?.isAdmin) return NextResponse.json({ error: "Nur Admins können für die Agentur exportieren." }, { status: 403 });

  const supabase = await createClient();
  const [{ data: project }, page] = await Promise.all([
    supabase.from("projects").select("title, brand").eq("id", id).single(),
    loadPage(id),
  ]);
  if (!project || !page) return NextResponse.json({ error: "Seite nicht gefunden." }, { status: 404 });

  const admin = createAdminClient();
  await ensureBucket(admin);

  // Übersetzungs-Zwischenspeicher des Projekts
  const cachePath = `${id}/translations.json`;
  let cache: TranslationCache = {};
  const { data: cached } = await admin.storage.from(BUCKET).download(cachePath);
  if (cached) {
    try {
      cache = JSON.parse(await cached.text());
    } catch {
      cache = {};
    }
  }

  let result;
  try {
    result = await buildMiniCms({
      html: cleanHtml(page.html),
      title: project.title,
      brand: project.brand,
      deps: {
        fetchAsset: (url) => fetchAsset(admin, url).catch(() => null),
        translate: (units, from, to) => translateUnits(units, from, to, cache),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Der Export ist fehlgeschlagen: ${(err as Error).message}` }, { status: 500 });
  }

  const zip = new JSZip();
  for (const f of result.files) zip.file(`${result.name}/${f.path}`, f.content);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  const zipPath = `${id}/${result.name}.zip`;
  const [upload] = await Promise.all([
    admin.storage.from(BUCKET).upload(zipPath, bytes, { contentType: "application/zip", upsert: true }),
    admin.storage
      .from(BUCKET)
      .upload(cachePath, JSON.stringify(cache), { contentType: "application/json", upsert: true }),
  ]);
  if (upload.error) return NextResponse.json({ error: `ZIP konnte nicht gespeichert werden: ${upload.error.message}` }, { status: 500 });

  const { data: signed } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(zipPath, 60 * 60, { download: `${result.name}.zip` });
  if (!signed?.signedUrl) return NextResponse.json({ error: "Download-Link konnte nicht erstellt werden." }, { status: 500 });

  return NextResponse.json({
    name: result.name,
    url: signed.signedUrl,
    sizeBytes: bytes.byteLength,
    files: result.files.length,
    issues: result.issues,
  });
}
