"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { prunableVersions } from "@/lib/page/retention";

export interface StorageOverview {
  databaseBytes: number;
  buckets: { bucket: string; bytes: number; files: number }[];
  projects: {
    id: string;
    title: string;
    brand: string;
    pageBytes: number;
    versions: number;
    versionsBytes: number;
    imageBytes: number;
  }[];
}

type Fail = { ok: false; error: string };

/** Speicherverbrauch laut Datenbank (nur Admins, braucht SQL 0019). */
export async function getStorageOverview(): Promise<{ ok: true; data: StorageOverview } | Fail> {
  const me = await getCurrentProfile();
  if (!me?.is_admin) return { ok: false, error: "Nur für Admins." };
  const { data, error } = await (await createClient()).rpc("storage_overview" as never);
  if (error || !data) {
    return { ok: false, error: "Die Speicher-Übersicht ist noch nicht eingerichtet (SQL-Datei 0019 in Supabase ausführen)." };
  }
  const d = data as {
    database_bytes: number;
    buckets: { bucket: string; bytes: number; files: number }[];
    projects: { id: string; title: string; brand: string; page_bytes: number; versions: number; versions_bytes: number; image_bytes: number }[];
  };
  return {
    ok: true,
    data: {
      databaseBytes: Number(d.database_bytes) || 0,
      buckets: (d.buckets ?? []).map((b) => ({ bucket: b.bucket, bytes: Number(b.bytes) || 0, files: Number(b.files) || 0 })),
      projects: (d.projects ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        brand: p.brand,
        pageBytes: Number(p.page_bytes) || 0,
        versions: Number(p.versions) || 0,
        versionsBytes: Number(p.versions_bytes) || 0,
        imageBytes: Number(p.image_bytes) || 0,
      })),
    },
  };
}

/**
 * Alte automatische Versionen aller Seiten finden bzw. löschen.
 * `apply = false` zählt nur (Vorschau), `true` löscht.
 */
export async function pruneVersions(apply: boolean): Promise<{ ok: true; count: number; bytes: number } | Fail> {
  const me = await getCurrentProfile();
  if (!me?.is_admin) return { ok: false, error: "Nur für Admins." };
  const admin = createAdminClient();
  const base = "id, page_id, source, created_at, version_no";
  const read = (cols: string) => admin.from("page_versions").select(cols).order("version_no", { ascending: false });
  // Mit Größe (SQL 0019); fehlt die Spalte noch, ohne.
  let { data, error } = await read(`${base}, size_bytes`);
  if (error) ({ data, error } = await read(base));
  if (error) return { ok: false, error: "Versionen konnten nicht gelesen werden." };

  const rows = (data ?? []) as unknown as { id: string; page_id: string; source: string; created_at: string; size_bytes?: number }[];
  const byPage = new Map<string, typeof rows>();
  for (const r of rows) byPage.set(r.page_id, [...(byPage.get(r.page_id) ?? []), r]);
  const ids = [...byPage.values()].flatMap((list) => prunableVersions(list));
  const sizeById = new Map(rows.map((r) => [r.id, Number(r.size_bytes) || 0]));
  const bytes = ids.reduce((n, id) => n + (sizeById.get(id) ?? 0), 0);

  if (apply && ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error: delError } = await admin.from("page_versions").delete().in("id", ids.slice(i, i + 200));
      if (delError) return { ok: false, error: "Löschen fehlgeschlagen." };
    }
    revalidatePath("/admin/speicher");
  }
  return { ok: true, count: ids.length, bytes };
}
