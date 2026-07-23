import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const IMAGE_BUCKET = "project-images";
const REF_PREFIX = "sb:";
const SIGNED_URL_TTL = 60 * 60; // 1 Stunde

type Client = SupabaseClient<Database>;

/** Ist der Bildwert eine Referenz auf ein Objekt im Storage-Bucket? */
export function isStorageRef(value: string): boolean {
  return value.startsWith(REF_PREFIX);
}

export function toStorageRef(path: string): string {
  return `${REF_PREFIX}${path}`;
}

export function toStoragePath(ref: string): string {
  return ref.slice(REF_PREFIX.length);
}

/**
 * Ersetzt alle Storage-Referenzen (sb:...) in einer Bild-Map durch frisch
 * signierte, zeitlich begrenzte URLs. Originalbilder (data:/http/relative)
 * bleiben unverändert. Wird vor jedem renderHtml serverseitig aufgerufen.
 */
export async function resolveImages(
  supabase: Client,
  images: Record<string, string>,
): Promise<Record<string, string>> {
  const refEntries = Object.entries(images).filter(([, v]) => isStorageRef(v));
  if (refEntries.length === 0) return images;

  const paths = refEntries.map(([, v]) => toStoragePath(v));
  const { data } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);

  const urlByPath = new Map<string, string>();
  data?.forEach((entry, i) => {
    if (entry.signedUrl) urlByPath.set(paths[i], entry.signedUrl);
  });

  const resolved = { ...images };
  for (const [id, ref] of refEntries) {
    const url = urlByPath.get(toStoragePath(ref));
    if (url) resolved[id] = url;
  }
  return resolved;
}
