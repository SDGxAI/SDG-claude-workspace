import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteForm } from "@/components/admin/InviteForm";
import { RoleSelect } from "@/components/admin/RoleSelect";
import { DeleteUserButton } from "@/components/admin/DeleteUserButton";
import { PageContainer } from "@/components/PageContainer";
import type { ProjectRole } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) {
    redirect("/projects");
  }

  const [{ data: profiles }, { data: projects }, { data: members }] =
    await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("projects").select("id, title, brand").order("title"),
      supabase.from("project_members").select("*"),
    ]);

  const roleByUserAndProject = new Map<string, ProjectRole>();
  for (const m of members ?? []) {
    roleByUserAndProject.set(`${m.user_id}:${m.project_id}`, m.role);
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold text-neutral-900">
        Nutzer &amp; Rechte
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Personen einladen und pro Projekt festlegen, wer bearbeiten,
        kommentieren oder nur ansehen darf.
      </p>

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-medium text-neutral-900">Person einladen</h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">
          Die Person erhält eine E-Mail mit einem Link, um ihr Passwort
          festzulegen.
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
                <span className="font-medium text-neutral-900">
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
                {profile.id !== user.id && (
                  <div className="ml-auto">
                    <DeleteUserButton userId={profile.id} email={profile.email} />
                  </div>
                )}
              </div>

              {profile.is_admin ? (
                <p className="mt-3 text-sm text-neutral-500">
                  Admins haben automatisch vollen Zugriff auf alle Projekte.
                </p>
              ) : (projects ?? []).length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">
                  Noch keine Projekte vorhanden – Rollen können vergeben
                  werden, sobald das erste Projekt angelegt ist.
                </p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="py-1 pr-4 font-normal">Projekt</th>
                      <th className="py-1 font-normal">Rolle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(projects ?? []).map((project) => (
                      <tr key={project.id} className="border-t border-neutral-100">
                        <td className="py-2 pr-4 text-neutral-900">
                          {project.title}
                          <span className="ml-2 text-xs text-neutral-400">
                            {project.brand}
                          </span>
                        </td>
                        <td className="py-2">
                          <RoleSelect
                            projectId={project.id}
                            userId={profile.id}
                            currentRole={
                              roleByUserAndProject.get(
                                `${profile.id}:${project.id}`,
                              ) ?? null
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
