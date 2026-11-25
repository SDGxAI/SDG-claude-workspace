import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getStorageOverview, pruneVersions } from "@/lib/actions/storage";
import { PageContainer } from "@/components/PageContainer";
import { formatBytes } from "@/lib/briefing";
import { KEEP_NEWEST, RETENTION_DAYS } from "@/lib/page/retention";
import { PruneButton } from "./PruneButton";

export const dynamic = "force-dynamic";

/**
 * Grenzen des Supabase-Tarifs. Nach einem Wechsel auf Pro in Vercel
 * SUPABASE_PLAN=pro setzen (Werte nach Stand der Supabase-Preisseite prüfen).
 */
const LIMITS =
  process.env.SUPABASE_PLAN === "pro"
    ? { plan: "Pro", db: 8 * 1024 ** 3, files: 100 * 1024 ** 3 }
    : { plan: "Kostenlos", db: 500 * 1024 ** 2, files: 1024 ** 3 };

const BUCKET_LABEL: Record<string, string> = {
  "ki-assets": "Bilder der Seiten",
  briefings: "Briefing-Fotos & -Videos",
  avatars: "Profilbilder",
  "project-images": "Bilder (alter Editor)",
};

function Bar({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  const tone = pct > 85 ? "bg-sdg-red" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-neutral-100">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, 1)}%` }} />
    </div>
  );
}

export default async function StoragePage() {
  const me = await getCurrentProfile();
  if (!me?.is_admin) redirect("/projects");
  const [res, prune] = await Promise.all([getStorageOverview(), pruneVersions(false)]);

  const card = "rounded-3xl border border-white bg-white/90 p-6 shadow-sm";
  const head = (
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Speicher</h1>
      <p className="mt-1 max-w-2xl text-neutral-500">Wie viel Platz ist noch frei, und was braucht am meisten? Tarif: {LIMITS.plan}.</p>
    </div>
  );

  if (!res.ok) {
    return (
      <PageContainer>
        {head}
        <p className="mt-8 rounded-2xl bg-amber-50 p-5 text-sm text-amber-900">{res.error}</p>
      </PageContainer>
    );
  }

  const { databaseBytes, buckets, projects } = res.data;
  const filesBytes = buckets.reduce((n, b) => n + b.bytes, 0);
  const rows = projects
    .map((p) => ({ ...p, total: p.pageBytes + p.versionsBytes + p.imageBytes }))
    .sort((a, b) => b.total - a.total);

  return (
    <PageContainer>
      {head}

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className={card}>
          <div className="text-sm text-neutral-500">Datenbank (Seiten, Versionen, Kommentare, Briefings)</div>
          <div className="mt-1 text-3xl font-bold tracking-tight text-neutral-900">
            {formatBytes(databaseBytes)} <span className="text-base font-medium text-neutral-400">von {formatBytes(LIMITS.db)}</span>
          </div>
          <Bar used={databaseBytes} limit={LIMITS.db} />
          <div className="mt-2 text-xs text-neutral-400">noch frei: {formatBytes(Math.max(0, LIMITS.db - databaseBytes))}</div>
        </section>
        <section className={card}>
          <div className="text-sm text-neutral-500">Dateien (Bilder, Fotos, Videos)</div>
          <div className="mt-1 text-3xl font-bold tracking-tight text-neutral-900">
            {formatBytes(filesBytes)} <span className="text-base font-medium text-neutral-400">von {formatBytes(LIMITS.files)}</span>
          </div>
          <Bar used={filesBytes} limit={LIMITS.files} />
          <ul className="mt-3 space-y-1 text-sm">
            {buckets.map((b) => (
              <li key={b.bucket} className="flex justify-between text-neutral-600">
                <span>
                  {BUCKET_LABEL[b.bucket] ?? b.bucket} <span className="text-neutral-400">· {b.files} Dateien</span>
                </span>
                <span className="font-mono">{formatBytes(b.bytes)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className={`${card} mt-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-neutral-900">Alte Versionen aufräumen</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Automatisch angelegte Versionen werden nach {RETENTION_DAYS} Tagen gelöscht – das passiert von selbst, sobald an einer Seite
              wieder gearbeitet wird. Von Hand gespeicherte Versionen und die {KEEP_NEWEST} neuesten je Seite bleiben immer.
            </p>
            <p className="mt-2 text-sm text-neutral-700">
              {prune.ok
                ? prune.count
                  ? `Jetzt löschbar: ${prune.count} Versionen (${formatBytes(prune.bytes)}).`
                  : "Gerade gibt es nichts aufzuräumen."
                : prune.error}
            </p>
          </div>
          {prune.ok && prune.count > 0 && <PruneButton count={prune.count} />}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 px-1 text-lg font-semibold text-neutral-900">Was am meisten Platz braucht</h2>
        <div className="overflow-x-auto rounded-3xl border border-white bg-white/90 shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-neutral-400">
              <tr>
                <th className="px-5 py-3 font-medium">Projekt</th>
                <th className="px-3 py-3 text-right font-medium">Seite</th>
                <th className="px-3 py-3 text-right font-medium">Versionen</th>
                <th className="px-3 py-3 text-right font-medium">Bilder</th>
                <th className="px-5 py-3 text-right font-medium">Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-neutral-100">
                  <td className="px-5 py-3">
                    <Link href={`/projects/${p.id}`} className="font-medium text-neutral-900 hover:text-sdg-red">
                      {p.title}
                    </Link>
                    <span className="ml-2 text-xs text-neutral-400">{p.brand}</span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-neutral-600">{formatBytes(p.pageBytes)}</td>
                  <td className="px-3 py-3 text-right font-mono text-neutral-600">
                    {formatBytes(p.versionsBytes)} <span className="text-neutral-400">({p.versions})</span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-neutral-600">{formatBytes(p.imageBytes)}</td>
                  <td className="px-5 py-3 text-right font-mono font-semibold text-neutral-900">{formatBytes(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} mt-8`}>
        <h2 className="text-lg font-semibold text-neutral-900">Vercel-Speicher (Veröffentlichungen)</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          Das ist etwas anderes: Vercel bewahrt jede veröffentlichte Fassung der App auf (nicht Eure Seiten oder Versionen). Dieser Wert
          lässt sich hier nicht auslesen – er steht in Vercel unter „Usage“. Im kostenlosen Tarif löscht Vercel bei Bedarf alte
          Veröffentlichungen von selbst; die laufende App ist davon nicht betroffen.
        </p>
      </section>
    </PageContainer>
  );
}
