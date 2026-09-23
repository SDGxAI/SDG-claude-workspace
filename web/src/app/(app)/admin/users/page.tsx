import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { InviteForm } from "@/components/admin/InviteForm";
import { CreateUserForm } from "@/components/admin/CreateUserForm";
import { DeleteUserButton } from "@/components/admin/DeleteUserButton";
import { AdminToggle } from "@/components/admin/AdminToggle";
import { UserAccessEditor } from "@/components/admin/UserAccessEditor";
import { NameEditor } from "@/components/admin/NameEditor";
import { PageContainer } from "@/components/PageContainer";
import { SDG_BRANDS } from "@/lib/brands";
import type { AccessRole } from "@/lib/actions/invite";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  // Nutzer + Admin-Flag aus dem pro Request memoisierten Profil (Layout).
  const me = await getCurrentProfile();
  if (!me) {
    redirect("/login");
  }
  if (!me.is_admin) {
    redirect("/projects");
  }

  const supabase = await createClient();
  const [{ data: profiles }, { data: brandRoles }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("user_brand_roles").select("user_id, brand, role"),
  ]);

  // „Online" = in den letzten 2 Minuten aktiv gewesen.
  const ONLINE_MS = 2 * 60 * 1000;
  // Server-Zeit einmal pro Request – bewusst als Momentaufnahme.
  const now = Date.now();
  const isOnline = (iso: string | null | undefined) =>
    !!iso && now - new Date(iso).getTime() < ONLINE_MS;
  const onlineProfiles = (profiles ?? []).filter((p) => isOnline(p.last_seen_at));

  // Je Nutzer: eine Rolle (aus der ersten Zuweisung) + Liste der Marken.
  const accessByUser = new Map<string, { role: AccessRole; brands: string[] }>();
  for (const r of brandRoles ?? []) {
    const entry = accessByUser.get(r.user_id) ?? {
      role: (r.role === "editor" ? "editor" : "reviewer") as AccessRole,
      brands: [],
    };
    // Editor „gewinnt", falls gemischt (sollte durch UI nicht vorkommen).
    if (r.role === "editor") entry.role = "editor";
    entry.brands.push(r.brand);
    accessByUser.set(r.user_id, entry);
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold text-neutral-900">
        Nutzer &amp; Rechte
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Personen anlegen und je Marke festlegen, wer bearbeiten oder
        kommentieren darf – gilt automatisch für alle Projekte der Marke.
      </p>

      <section className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
        <h2 className="flex items-center gap-2 font-medium text-neutral-900">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
          Gerade online ({onlineProfiles.length})
        </h2>
        {onlineProfiles.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">
            Aktuell ist niemand in der App aktiv.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {onlineProfiles.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-sm text-neutral-800 shadow-sm"
                title={p.email}
              >
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {p.name || p.email}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-400">
          Aktiv in den letzten 2 Minuten · Seite neu laden zum Aktualisieren.
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-medium text-neutral-900">
          Nutzer direkt anlegen (mit Start-Passwort)
        </h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          Ohne E-Mail-Versand: Du vergibst ein Start-Passwort und gibst
          E-Mail + Passwort persönlich weiter. Die Person muss beim ersten
          Login ein eigenes Passwort festlegen.
        </p>
        <CreateUserForm brands={[...SDG_BRANDS]} />
      </section>

      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-medium text-neutral-900">
          Alternativ: Person per E-Mail einladen
        </h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          Die Person erhält eine E-Mail mit einem Link, um ihr Passwort
          selbst festzulegen.
        </p>
        <InviteForm brands={[...SDG_BRANDS]} />
      </section>

      <section className="mt-6">
        <h2 className="font-medium text-neutral-900">
          Eingeladene Personen ({profiles?.length ?? 0})
        </h2>

        <div className="mt-3 space-y-4">
          {(profiles ?? []).map((profile) => (
            <div
              key={profile.id}
              className="rounded-xl border border-neutral-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    isOnline(profile.last_seen_at) ? "bg-green-500" : "bg-neutral-300"
                  }`}
                  title={isOnline(profile.last_seen_at) ? "Online" : "Offline"}
                />
                <NameEditor userId={profile.id} currentName={profile.name} />
                <span className="text-sm text-neutral-500">
                  {profile.email}
                </span>
                {profile.is_admin && (
                  <span className="rounded-full bg-sdg-red-light px-2 py-0.5 text-xs font-medium text-sdg-red-dark">
                    Admin
                  </span>
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    profile.status === "aktiv"
                      ? "bg-green-100 text-green-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {profile.status === "aktiv"
                    ? "Aktiv"
                    : "Eingeladen – noch nicht angenommen"}
                </span>
                {profile.id !== me.id && (
                  <div className="ml-auto flex items-center gap-4">
                    <AdminToggle
                      userId={profile.id}
                      email={profile.email}
                      isAdmin={profile.is_admin}
                    />
                    <DeleteUserButton userId={profile.id} email={profile.email} />
                  </div>
                )}
              </div>

              {profile.is_admin ? (
                <p className="mt-3 text-sm text-neutral-500">
                  Admins haben automatisch vollen Zugriff auf alle Projekte.
                </p>
              ) : (
                <UserAccessEditor
                  userId={profile.id}
                  allBrands={[...SDG_BRANDS]}
                  initialRole={accessByUser.get(profile.id)?.role ?? "reviewer"}
                  initialBrands={accessByUser.get(profile.id)?.brands ?? []}
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
