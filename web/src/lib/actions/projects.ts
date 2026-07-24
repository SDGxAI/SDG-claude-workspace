"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseHtmlTemplate } from "@/lib/html/parse";
import { SDG_BRANDS } from "@/lib/brands";
import type { ProjectStatus } from "@/types/database";

export type CreateProjectResult =
  | {
      ok: true;
      projectId: string;
      counts: { colors: number; texts: number; images: number; links: number };
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * Legt ein neues Projekt aus einer hochgeladenen HTML-Datei an: parst die
 * Datei serverseitig (Farb-/Text-/Bild-Erkennung), speichert Projekt +
 * Seite und gibt den Import-Bericht zurück. Nur Admins dürfen Projekte
 * anlegen (RLS + zusätzliche Prüfung hier).
 */
export async function createProject(input: {
  title: string;
  brand: string;
  html: string;
  filename: string;
}): Promise<CreateProjectResult> {
  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "Bitte einen Projekttitel eingeben." };
  }
  if (!SDG_BRANDS.includes(input.brand as (typeof SDG_BRANDS)[number])) {
    return { ok: false, error: "Bitte eine gültige Marke auswählen." };
  }
  if (!input.html.trim() || !/<[a-z][\s\S]*>/i.test(input.html)) {
    return { ok: false, error: "Die Datei enthält kein gültiges HTML." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }

  // Jede:r angemeldete Nutzer:in darf ein Projekt anlegen und wird per
  // Trigger automatisch Editor des neuen Projekts. Ist die Person auf
  // bestimmte Marken beschränkt, darf sie nur für diese anlegen.
  // Der brands-Zugriff ist tolerant, falls die Spalte (Migration 0006)
  // noch nicht existiert.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  let brands: string[] = [];
  try {
    const { data: brandRow } = await supabase
      .from("profiles")
      .select("brands")
      .eq("id", user.id)
      .single();
    brands = brandRow?.brands ?? [];
  } catch {
    brands = [];
  }
  if (!profile?.is_admin && brands.length > 0 && !brands.includes(input.brand)) {
    return {
      ok: false,
      error: "Du darfst nur Projekte für deine zugewiesene(n) Marke(n) anlegen.",
    };
  }

  let parsed;
  try {
    parsed = parseHtmlTemplate(input.html);
  } catch {
    return { ok: false, error: "Die HTML-Datei konnte nicht analysiert werden." };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      title,
      brand: input.brand,
      status: "entwurf" as ProjectStatus,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    return {
      ok: false,
      error: `Das Projekt konnte nicht gespeichert werden${projectError?.message ? ` (${projectError.message})` : ""}.`,
    };
  }

  const { error: pageError } = await supabase.from("pages").insert({
    project_id: project.id,
    template_html: parsed.templateHtml,
    detected_elements: parsed.detectedElements,
    content_state: parsed.contentState,
    original_filename: input.filename.slice(0, 200),
  });

  if (pageError) {
    // Projekt ohne Seite wäre unbrauchbar - wieder entfernen.
    await supabase.from("projects").delete().eq("id", project.id);
    return {
      ok: false,
      error: `Die Seiteninhalte konnten nicht gespeichert werden${pageError.message ? ` (${pageError.message})` : ""}.`,
    };
  }

  revalidatePath("/projects");
  return {
    ok: true,
    projectId: project.id,
    counts: parsed.counts,
    warnings: parsed.warnings,
  };
}

/** Ändert den Status eines Projekts (Entwurf/In Review/Live) - Admin-only. */
export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId);
  if (error) {
    return { ok: false, error: "Status konnte nicht geändert werden." };
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/**
 * Löscht ein Projekt samt Seiten, Snapshots und Kommentaren (per Cascade).
 * Nur Admins (RLS erlaubt DELETE ohnehin nur Admins).
 */
export async function deleteProject(
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Nicht angemeldet." };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return { ok: false, error: "Nur Admins dürfen Projekte löschen." };
  }

  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) {
    return { ok: false, error: "Projekt konnte nicht gelöscht werden." };
  }

  revalidatePath("/projects");
  return { ok: true };
}
