"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectAccess } from "@/lib/access";
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

const DIRECT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB (Upload geht direkt in den Speicher)

export type PrepareUploadResult =
  | { ok: true; bucket: string; path: string; token: string }
  | { ok: false; error: string };

/**
 * Bereitet einen DIREKTEN Bild-Upload in den Speicher vor (am Server vorbei).
 * So gibt es keine Größengrenze des Hostings (4,5 MB) – wichtig für Fotos.
 * Nur Editor:innen/Admins des Projekts.
 */
export async function prepareProjectImageUpload(
  projectId: string,
  contentType: string,
  size: number,
): Promise<PrepareUploadResult> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung zum Bearbeiten." };
  if (!ALLOWED.includes(contentType)) {
    return { ok: false, error: "Nicht unterstütztes Bildformat (erlaubt: JPG, PNG, WebP, GIF, SVG)." };
  }
  if (size > DIRECT_MAX_BYTES) return { ok: false, error: "Bild ist zu groß (max. 25 MB)." };

  const path = `${projectId}/${crypto.randomUUID()}.${EXT[contentType]}`;
  const { data, error } = await createAdminClient()
    .storage.from(IMAGE_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return {
      ok: false,
      error: `Upload konnte nicht vorbereitet werden${error?.message ? ` (${error.message})` : ""}. Ist der Speicher „${IMAGE_BUCKET}“ eingerichtet?`,
    };
  }
  return { ok: true, bucket: IMAGE_BUCKET, path: data.path, token: data.token };
}

/** Nach dem direkten Upload: Referenz + Vorschau-Adresse für den Editor. */
export async function finishProjectImageUpload(
  projectId: string,
  path: string,
): Promise<UploadResult> {
  const access = await getProjectAccess(projectId);
  if (!access?.canEdit) return { ok: false, error: "Keine Berechtigung zum Bearbeiten." };
  if (!path.startsWith(`${projectId}/`) || path.includes("..")) {
    return { ok: false, error: "Ungültiger Bildpfad." };
  }
  const { data, error } = await createAdminClient()
    .storage.from(IMAGE_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data) {
    return { ok: false, error: "Das Bild wurde nicht gefunden – bitte erneut hochladen." };
  }
  return { ok: true, ref: toStorageRef(path), url: data.signedUrl };
}
