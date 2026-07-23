import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectGrid } from "@/components/projects/ProjectGrid";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.is_admin ?? false;

  // RLS liefert automatisch nur Projekte, die die Person sehen darf
  // (Admins alle, andere nur zugewiesene).
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, brand, status, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Projekte</h1>
        {isAdmin && (
          <Link
            href="/projects/new"
            className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark"
          >
            + Neues Projekt
          </Link>
        )}
      </div>

      <div className="mt-6">
        {(projects ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
            <p className="text-neutral-600">
              {isAdmin
                ? "Noch keine Projekte. Lade eine HTML-Landingpage hoch, um zu starten."
                : "Dir wurden noch keine Projekte zugewiesen."}
            </p>
            {isAdmin && (
              <Link
                href="/projects/new"
                className="mt-4 inline-block rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark"
              >
                + Erstes Projekt anlegen
              </Link>
            )}
          </div>
        ) : (
          <ProjectGrid projects={projects ?? []} />
        )}
      </div>
    </div>
  );
}
