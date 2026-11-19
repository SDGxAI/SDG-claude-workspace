import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { PageContainer } from "@/components/PageContainer";
import { BRIEFING_STATUS } from "@/lib/briefing";
import { brandGradient } from "@/lib/ui/brandColor";
import type { BriefingFile, BriefingStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function BriefingsPage() {
  const me = await getCurrentProfile();
  const supabase = await createClient();
  // RLS: Admins sehen alle Briefings, alle anderen ihre eigenen.
  const { data, error } = await supabase
    .from("briefings")
    .select("id, brand, title, status, files, go_live, created_at, created_by, wants_ai_text")
    .order("created_at", { ascending: false });
  const rows = data ?? [];

  const emailById = new Map<string, string>();
  if (me?.is_admin && rows.length) {
    const ids = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
    const { data: people } = await createAdminClient().from("profiles").select("id, email").in("id", ids);
    (people ?? []).forEach((p) => emailById.set(p.id, p.email));
  }
  const date = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <PageContainer>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Briefings</h1>
          <p className="mt-1 text-neutral-500">
            {me?.is_admin ? "Alle eingereichten Briefings der Marken." : "Deine eingereichten Briefings."}
          </p>
        </div>
        <Link
          href="/briefings/new"
          className="rounded-full bg-sdg-red px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sdg-red-dark"
        >
          + Neues Briefing
        </Link>
      </div>

      {error && /relation|briefings/i.test(error.message) ? (
        <p className="mt-8 rounded-2xl bg-amber-50 p-5 text-sm text-amber-900">
          Briefings sind noch nicht eingerichtet: Bitte die SQL-Datei <code>0018_briefings.sql</code> in Supabase ausführen.
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-neutral-300 bg-white/70 p-12 text-center">
          <div className="text-4xl">✍️</div>
          <p className="mt-3 text-neutral-600">Noch keine Briefings. In 5 Minuten ist das erste fertig.</p>
          <Link
            href="/briefings/new"
            className="mt-5 inline-block rounded-full bg-sdg-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-sdg-red-dark"
          >
            Briefing einreichen
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((b) => {
            const status = BRIEFING_STATUS[b.status as BriefingStatus];
            const files = (b.files ?? []) as BriefingFile[];
            return (
              <Link
                key={b.id}
                href={`/briefings/${b.id}`}
                className="group flex flex-col overflow-hidden rounded-3xl border border-white bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className={`flex h-20 items-end justify-between bg-gradient-to-br px-5 pb-3 ${brandGradient(b.brand)}`}>
                  <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
                    {b.brand}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>{status.label}</span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-lg font-semibold leading-snug text-neutral-900 group-hover:text-sdg-red">{b.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-neutral-500">
                    {files.length > 0 && <span className="rounded-full bg-neutral-100 px-2 py-0.5">📸 {files.length}</span>}
                    {b.wants_ai_text && <span className="rounded-full bg-neutral-100 px-2 py-0.5">✨ Text per KI</span>}
                    {b.go_live && <span className="rounded-full bg-neutral-100 px-2 py-0.5">📅 {date(b.go_live)}</span>}
                  </div>
                  <p className="mt-auto pt-5 text-xs text-neutral-400">
                    {date(b.created_at)}
                    {me?.is_admin && b.created_by ? ` · ${emailById.get(b.created_by) ?? ""}` : ""}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
