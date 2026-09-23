import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { InviteForm } from "@/components/admin/InviteForm";
import { CreateUserForm } from "@/components/admin/CreateUserForm";
import { DeleteUserButton } from "@/components/admin/DeleteUserButton";
import { AdminToggle } from "@/components/admin/AdminToggle";
import { UserBrandRolesEditor } from "@/components/admin/UserBrandRolesEditor";
import { NameEditor } from "@/components/admin/NameEditor";
import { PageContainer } from "@/components/PageContainer";
import { SDG_BRANDS } from "@/lib/brands";
import type { ProjectRole } from "@/types/database";
import type { BrandRoleMap } from "@/components/admin/BrandRoleRows";

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

  // Marken-Rollen je Nutzer als Map {brand: role}.
  const rolesByUser = new Map<string, BrandRoleMap>();
  for (const r of brandRoles ?? []) {
    const m = rolesByUser.get(r.user_id) ?? {};
    m[r.brand] = r.role as ProjectRole;
    rolesByUser.set(r.user_id, m);
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

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
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
        <InviteForm />
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
                <UserBrandRolesEditor
                  userId={profile.id}
                  brands={[...SDG_BRANDS]}
                  current={rolesByUser.get(profile.id) ?? {}}
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
