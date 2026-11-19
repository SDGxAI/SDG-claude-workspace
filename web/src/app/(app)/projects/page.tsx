import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { ProjectGrid } from "@/components/projects/ProjectGrid";
import { PageContainer } from "@/components/PageContainer";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();

  // Beide Abfragen sind unabhängig und laufen parallel (ein statt zwei
  // aufeinanderfolgende Roundtrips). RLS liefert automatisch nur Projekte,
  // die die Person sehen darf (Admins alle, andere nur zugewiesene).
  const [{ data: projects }, { data: openComments }, { data: shopifyProjects }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, brand, status, updated_at")
      .order("updated_at", { ascending: false }),
    // Anzahl offener Kommentare je Projekt (für die Badge auf den Karten).
    supabase
      .from("comments")
      .select("id, pages!inner(project_id)")
      .eq("status", "offen")
      .is("parent_id", null),
    // Projekte aus Shopify (Markierung auf der Karte). Liefert ohne
    // Migration 0015 einfach nichts.
    supabase.from("projects").select("id").eq("source", "shopify"),
  ]);
  const shopifyIds = new Set((shopifyProjects ?? []).map((p) => p.id));

  const openByProject: Record<string, number> = {};
  for (const c of openComments ?? []) {
    const pid = (c.pages as unknown as { project_id: string }).project_id;
    openByProject[pid] = (openByProject[pid] ?? 0) + 1;
  }

  const cards = (projects ?? []).map((p) => ({
    ...p,
    openComments: openByProject[p.id] ?? 0,
    isShopify: shopifyIds.has(p.id),
  }));

  // Stunde in deutscher Zeit als reine Zahl (0–23).
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" }).format(new Date()),
  );
  const greeting = hour >= 5 && hour < 11 ? "Guten Morgen" : hour >= 11 && hour < 18 ? "Hallo" : "Guten Abend";
  const openTotal = cards.reduce((n, c) => n + c.openComments, 0);
  const firstName = (await getCurrentProfile())?.name?.trim().split(/\s+/)[0];

  return (
    <PageContainer>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">{greeting}{firstName ? `, ${firstName}` : ""} 👋</h1>
          <p className="mt-1 text-neutral-500">
            {cards.length === 0
              ? "Schön, dass du da bist."
              : openTotal > 0
                ? `${openTotal} offene${openTotal === 1 ? "r" : ""} Kommentar${openTotal === 1 ? "" : "e"} in deinen Projekten.`
                : "Alles erledigt – keine offenen Kommentare."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/briefings/new"
            className="rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            ✍️ Briefing einreichen
          </Link>
          <Link
            href="/projects/new"
            className="rounded-full bg-sdg-red px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sdg-red-dark"
          >
            + Neues Projekt
          </Link>
        </div>
      </div>

      <div className="mt-8">
        {(projects ?? []).length === 0 ? (
          <div className="rounded-3xl border border-dashed border-neutral-300 bg-white/70 p-12 text-center">
            <div className="text-4xl">🚀</div>
            <p className="mt-3 text-neutral-600">
              Noch keine Projekte. Lade eine Landingpage hoch oder reiche ein Briefing ein.
            </p>
            <Link
              href="/projects/new"
              className="mt-5 inline-block rounded-full bg-sdg-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-sdg-red-dark"
            >
              + Erstes Projekt anlegen
            </Link>
          </div>
        ) : (
          <ProjectGrid projects={cards} />
        )}
      </div>
    </PageContainer>
  );
}
