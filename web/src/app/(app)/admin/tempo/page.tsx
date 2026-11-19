import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { loadPage } from "@/lib/page/store";
import { listModels } from "@/lib/ai/claude";
import { PageContainer } from "@/components/PageContainer";
import { TempoClient } from "./TempoClient";

export const dynamic = "force-dynamic";

const BOOTED_AT = Date.now();

/** Messseite: wo geht beim Laden die Zeit verloren? (nur Admins) */
export default async function TempoPage() {
  const me = await getCurrentProfile();
  if (!me?.is_admin) redirect("/projects");

  const steps: { label: string; ms: number; note?: string }[] = [];
  const time = async <T,>(label: string, fn: () => PromiseLike<T>, note?: (v: T) => string) => {
    const t = Date.now();
    const v = await fn();
    steps.push({ label, ms: Date.now() - t, note: note?.(v) });
    return v;
  };

  const supabase = await createClient();
  await time("Anmeldung prüfen (Supabase Auth)", () => supabase.auth.getUser());
  await time("Einfache Datenbank-Abfrage", () => supabase.from("profiles").select("id").limit(1));
  const { data: project } = await time(
    "Projektliste laden",
    () => supabase.from("projects").select("id, title").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  );
  if (project) {
    await time(`Seite laden („${project.title}“)`, () => loadPage(project.id), (p) =>
      p ? `${Math.round(p.html.length / 1024)} KB` : "keine Seite",
    );
  }
  await time("KI-Modelle (zwischengespeichert)", () => listModels(), (m) => `${m.length} Modelle`);

  return (
    <PageContainer>
      <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Tempo-Check</h1>
      <p className="mt-1 max-w-2xl text-neutral-500">
        Zeigt, wo beim Laden die Zeit verloren geht. Bitte einmal öffnen, kurz warten, „Messen“ klicken und einen Screenshot schicken.
      </p>
      <TempoClient
        region={process.env.VERCEL_REGION ?? "lokal"}
        instanceAgeS={Math.round((Date.now() - BOOTED_AT) / 1000)}
        steps={steps}
      />
    </PageContainer>
  );
}
