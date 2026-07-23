"use server";

import { createClient } from "@/lib/supabase/server";
import { IMAGE_BUCKET, toStorageRef } from "@/lib/storage";

export type UploadResult =
  | { ok: true; ref: string; url: string }
  | { ok: false; error: string };

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/**
 * Lädt ein Bild in den privaten Storage-Bucket (Pfad {projectId}/{uuid}.ext)
 * und gibt eine Storage-Referenz + eine signierte Vorschau-URL zurück.
 * RLS-Policies auf storage.objects erlauben Uploads nur Editoren/Admins.
 */
export async function uploadProjectImage(
  projectId: string,
  formData: FormData,
): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Keine Datei erhalten." };
  }
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: "Nicht unterstütztes Bildformat." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Bild ist zu groß (max. 10 MB)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  const path = `${projectId}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return {
      ok: false,
      error:
        "Upload fehlgeschlagen. Ist der Storage-Bucket eingerichtet und hast du Bearbeitungsrechte?",
    };
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (signError || !signed) {
    return { ok: false, error: "Vorschau-URL konnte nicht erstellt werden." };
  }

  return { ok: true, ref: toStorageRef(path), url: signed.signedUrl };
}
