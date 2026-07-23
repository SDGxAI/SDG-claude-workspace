import { NextResponse, type NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccess } from "@/lib/access";
import { renderHtml } from "@/lib/html/render";
import { IMAGE_BUCKET, isStorageRef, toStoragePath } from "@/lib/storage";
import type { ContentState, DetectedElement } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}

function extFromPath(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "png";
}

interface ImageBytes {
  bytes: Uint8Array;
  mime: string;
  ext: string;
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
  const { data: project } = await supabase
    .from("projects")
    .select("title")
    .eq("id", id)
    .single();
  const { data: page } = await supabase
    .from("pages")
    .select("template_html, content_state, detected_elements")
    .eq("project_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!project || !page) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const content = page.content_state as ContentState;
  const detected = page.detected_elements as DetectedElement[];
  const baseName = sanitizeFilename(project.title);

  // Bildbytes für Storage-Referenzen und Data-URIs beschaffen.
  async function getImageBytes(value: string): Promise<ImageBytes | null> {
    if (isStorageRef(value)) {
      const path = toStoragePath(value);
      const { data } = await supabase.storage.from(IMAGE_BUCKET).download(path);
      if (!data) return null;
      const buf = new Uint8Array(await data.arrayBuffer());
      const ext = extFromPath(path);
      const mime = data.type || `image/${ext === "jpg" ? "jpeg" : ext}`;
      return { bytes: buf, mime, ext };
    }
    const dataUri = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(value);
    if (dataUri) {
      const mime = dataUri[1];
      const isBase64 = !!dataUri[2];
      const raw = isBase64
        ? Buffer.from(dataUri[3], "base64")
        : Buffer.from(decodeURIComponent(dataUri[3]), "utf8");
      return {
        bytes: new Uint8Array(raw),
        mime,
        ext: EXT_BY_MIME[mime] ?? "png",
      };
    }
    return null; // http(s)- oder relative Pfade unverändert lassen
  }

  if (format === "html") {
    const images: Record<string, string> = { ...content.images };
    for (const [key, value] of Object.entries(content.images)) {
      const img = await getImageBytes(value);
      if (img) {
        const b64 = Buffer.from(img.bytes).toString("base64");
        images[key] = `data:${img.mime};base64,${b64}`;
      }
    }
    const html = renderHtml(page.template_html, { ...content, images }, detected);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.html"`,
      },
    });
  }

  // ZIP mit relativen Bildpfaden
  const zip = new JSZip();
  const imagesFolder = zip.folder("images");
  const images: Record<string, string> = { ...content.images };
  let counter = 0;

  for (const [key, value] of Object.entries(content.images)) {
    const img = await getImageBytes(value);
    if (img) {
      counter += 1;
      const filename = `bild-${counter}.${img.ext}`;
      imagesFolder?.file(filename, img.bytes);
      images[key] = `images/${filename}`;
    }
  }

  const html = renderHtml(page.template_html, { ...content, images }, detected);
  zip.file("index.html", html);
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
