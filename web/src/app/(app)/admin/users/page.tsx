import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { InviteForm } from "@/components/admin/InviteForm";
import { CreateUserForm } from "@/components/admin/CreateUserForm";
import { DeleteUserButton } from "@/components/admin/DeleteUserButton";
import { RoleButton } from "@/components/admin/RoleButton";
import { NameEditor } from "@/components/admin/NameEditor";
import { OnlineNow } from "@/components/admin/OnlineNow";
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
        Personen anlegen und per Rollen-Button festlegen, ob sie Reviewer,
        Editor oder Admin sind – die Rolle gilt automatisch für alle Projekte
        der gewählten Marken.
      </p>

      <OnlineNow />

      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-medium text-neutral-900">
          Person per E-Mail einladen
        </h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          Die Person erhält eine E-Mail im SDG-Design mit einem Link, über den
          sie ihr Passwort selbst festlegt.
        </p>
        <InviteForm brands={[...SDG_BRANDS]} />
      </section>

      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-medium text-neutral-900">
          Alternativ: Nutzer direkt anlegen (mit Start-Passwort)
        </h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          Ohne E-Mail: Du vergibst ein Start-Passwort und gibst E-Mail +
          Passwort persönlich weiter. Beim ersten Login legt die Person ein
          eigenes Passwort fest.
        </p>
        <CreateUserForm brands={[...SDG_BRANDS]} />
      </section>

      <section className="mt-6">
        <h2 className="font-medium text-neutral-900">
          Personen ({profiles?.length ?? 0})
        </h2>

        <div className="mt-3 space-y-3">
          {(profiles ?? []).map((profile) => {
            const access = accessByUser.get(profile.id);
            const isSelf = profile.id === me.id;
            return (
              <div
                key={profile.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-neutral-200 bg-white px-5 py-4"
              >
                <NameEditor userId={profile.id} currentName={profile.name} />
                <span className="text-sm text-neutral-500">{profile.email}</span>
                {profile.status !== "aktiv" && (
                  <span className="text-xs text-neutral-400">· Einladung offen</span>
                )}
                <div className="ml-auto flex items-center gap-4">
                  <RoleButton
                    userId={profile.id}
                    allBrands={[...SDG_BRANDS]}
                    initialRole={profile.is_admin ? "admin" : (access?.role ?? "reviewer")}
                    initialBrands={access?.brands ?? []}
                    isSelf={isSelf}
                  />
                  {!isSelf && (
                    <DeleteUserButton userId={profile.id} email={profile.email} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </PageContainer>
  );
}
