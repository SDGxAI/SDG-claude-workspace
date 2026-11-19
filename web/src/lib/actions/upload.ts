"use server";

import { createClient } from "@/lib/supabase/server";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const KI_ASSET_BUCKET = "ki-assets";

export type KiAssetResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Lädt ein Bild in den ÖFFENTLICHEN Bucket „ki-assets" und gibt eine
 * dauerhafte, öffentliche URL zurück. Diese URL kann die KI in „Mit KI
 * bearbeiten" direkt als <img src> in die Seite einbauen.
 */
export async function uploadKiAsset(
  projectId: string,
  formData: FormData,
): Promise<KiAssetResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Keine Datei erhalten." };
  if (!ALLOWED.includes(file.type)) return { ok: false, error: "Nicht unterstütztes Bildformat." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Bild ist zu groß (max. 10 MB)." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet." };

  const path = `${projectId}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error: uploadError } = await supabase.storage
    .from(KI_ASSET_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return {
      ok: false,
      error:
        "Upload fehlgeschlagen. Ist der Bucket „ki-assets“ eingerichtet (Migration 0012)?",
    };
  }

  const { data } = supabase.storage.from(KI_ASSET_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    return { ok: false, error: "Öffentliche URL konnte nicht erstellt werden." };
  }
  return { ok: true, url: data.publicUrl };
}
