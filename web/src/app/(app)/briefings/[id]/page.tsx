import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth";
import { PageContainer } from "@/components/PageContainer";
import { BriefingActions, BriefingText } from "@/components/briefings/BriefingActions";
import { BRIEFING_STATUS, formatBytes } from "@/lib/briefing";
import { brandGradient } from "@/lib/ui/brandColor";
import type { BriefingFile, BriefingStatus } from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white bg-white/90 p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function BriefingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentProfile();
  // RLS: nur eigene Briefings bzw. als Admin alle.
  const { data: b } = await (await createClient()).from("briefings").select("*").eq("id", id).maybeSingle();
  if (!b || !me) notFound();

  const admin = createAdminClient();
  const files = (b.files ?? []) as BriefingFile[];
  const [{ data: signed }, { data: author }] = await Promise.all([
    files.length
      ? admin.storage.from("briefings").createSignedUrls(files.map((f) => f.path), 60 * 60 * 6)
      : Promise.resolve({ data: [] as { signedUrl: string | null }[] }),
    b.created_by
      ? admin.from("profiles").select("email, name").eq("id", b.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const status = BRIEFING_STATUS[b.status as BriefingStatus];
  const date = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <PageContainer>
      <Link href="/briefings" className="text-sm text-neutral-500 hover:text-sdg-red">
        ← Briefings
      </Link>

      <div className={`mt-3 rounded-3xl bg-gradient-to-br p-7 sm:p-9 ${brandGradient(b.brand)}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-700">{b.brand}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">{b.title}</h1>
        <p className="mt-2 text-sm text-neutral-700">
          Eingereicht am {date(b.created_at)}
          {author ? ` von ${author.name?.trim() || author.email}` : ""}
          {b.go_live ? ` · Wunschtermin: ${date(b.go_live)}` : ""}
        </p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card title="Produkt">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-800">{b.product_info}</p>
            {b.important && (
              <p className="mt-4 rounded-2xl bg-sdg-red-light/60 px-4 py-3 text-sm text-neutral-800">
                <strong>Was der Marke wichtig ist:</strong> {b.important}
              </p>
            )}
          </Card>

          <Card title="Text">
            {b.own_text ? (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-800">{b.own_text}</p>
            ) : (
              <p className="text-neutral-600">✨ Die Marke wünscht sich einen SEO- und GEO-optimierten Text von uns.</p>
            )}
          </Card>

          {(b.wants_ai_text || b.ai_text || me.is_admin) && (
            <BriefingText id={b.id} initial={b.ai_text} isAdmin={me.is_admin} />
          )}

          <Card title={`Fotos & Videos (${files.length})`}>
            {b.kids_transfer_link && (
              <a
                href={b.kids_transfer_link}
                target="_blank"
                rel="noreferrer"
                className="mb-4 flex items-center gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                📦 Transferlink (Aufnahmen mit Kindern / große Dateien) öffnen ↗
              </a>
            )}
            {files.length === 0 ? (
              <p className="text-neutral-500">Keine Dateien hochgeladen.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {files.map((f, i) => {
                  const url = signed?.[i]?.signedUrl ?? null;
                  return (
                    <li key={f.path} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                      <div className="flex aspect-square items-center justify-center bg-neutral-100">
                        {url && f.type.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={f.name} className="h-full w-full object-cover" />
                        ) : url && f.type.startsWith("video/") ? (
                          <video src={url} controls preload="metadata" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-3xl">📄</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="min-w-0 truncate text-neutral-700">{f.name}</span>
                        {url && (
                          <a href={`${url}&download=${encodeURIComponent(f.name)}`} className="shrink-0 font-medium text-sdg-red hover:underline">
                            Laden · {formatBytes(f.size)}
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {(b.inspiration_urls.length > 0 || b.inspiration_note) && (
            <Card title="Inspiration">
              <ul className="space-y-2">
                {b.inspiration_urls.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="break-all text-sdg-red hover:underline">
                      {u} ↗
                    </a>
                  </li>
                ))}
              </ul>
              {b.inspiration_note && <p className="mt-3 text-neutral-700">„{b.inspiration_note}“</p>}
            </Card>
          )}
        </div>

        <BriefingActions
          briefing={{
            id: b.id,
            brand: b.brand,
            title: b.title,
            status: b.status as BriefingStatus,
            productInfo: b.product_info,
            important: b.important,
            ownText: b.own_text,
            inspirationUrls: b.inspiration_urls,
            inspirationNote: b.inspiration_note,
            aiText: b.ai_text,
          }}
          isAdmin={me.is_admin}
          canDelete={me.is_admin || (b.created_by === me.id && b.status === "neu")}
        />
      </div>
    </PageContainer>
  );
}
