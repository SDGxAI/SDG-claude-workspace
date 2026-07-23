"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const AVATAR_BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type AvatarResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Lädt ein Profilbild in den öffentlichen "avatars"-Bucket (Ordner
 * {userId}/) und speichert die URL im eigenen Profil. Jede angemeldete
 * Person darf nur ihr eigenes Bild setzen.
 */
export async function uploadAvatar(formData: FormData): Promise<AvatarResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Keine Datei erhalten." };
  }
  if (!EXT[file.type]) {
    return { ok: false, error: "Nicht unterstütztes Bildformat (PNG, JPG, WebP, GIF)." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Bild ist zu groß (max. 5 MB)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  const path = `${user.id}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return {
      ok: false,
      error: "Upload fehlgeschlagen. Ist der avatars-Bucket eingerichtet?",
    };
  }

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const url = data.publicUrl;

  // Profil-Update per Admin-Client (normale Nutzer dürfen ihr Profil per
  // RLS nicht selbst schreiben); es wird nur das eigene avatar_url gesetzt.
  const admin = createAdminClient();
  await admin.from("profiles").update({ avatar_url: url }).eq("id", user.id);

  revalidatePath("/profile");
  return { ok: true, url };
}
