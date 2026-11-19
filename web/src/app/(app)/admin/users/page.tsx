import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { OnlineNow } from "@/components/admin/OnlineNow";
import { InviteDialog, UserList, type UserRow } from "@/components/admin/UserList";
import { PageContainer } from "@/components/PageContainer";
import { SDG_BRANDS } from "@/lib/brands";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  if (!me.is_admin) redirect("/projects");

  const supabase = await createClient();
  const [{ data: profiles }, { data: brandRoles }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("user_brand_roles").select("user_id, brand, role"),
  ]);

  // Je Person: Rolle (Editor „gewinnt“) + Marken.
  const access = new Map<string, { editor: boolean; brands: string[] }>();
  for (const r of brandRoles ?? []) {
    const a = access.get(r.user_id) ?? { editor: false, brands: [] };
    a.editor ||= r.role === "editor";
    a.brands.push(r.brand);
    access.set(r.user_id, a);
  }
  const users: UserRow[] = (profiles ?? []).map((p) => {
    const a = access.get(p.id);
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      invited: p.status !== "aktiv",
      role: p.is_admin ? "admin" : a?.editor ? "editor" : "reviewer",
      brands: a?.brands ?? [],
      avatarUrl: p.avatar_url,
    };
  });
  const invited = users.filter((u) => u.invited).length;

  const stat = (label: string, value: number, note: string) => (
    <div className="rounded-3xl border border-white bg-white/90 p-5 shadow-sm">
      <div className="text-sm text-neutral-500">{label}</div>
      <div className="mt-1 text-3xl font-bold tracking-tight text-neutral-900">{value}</div>
      <div className="mt-2 text-xs text-neutral-400">{note}</div>
    </div>
  );

  return (
    <PageContainer>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Nutzer &amp; Rechte</h1>
          <p className="mt-1 max-w-xl text-neutral-500">
            Wer darf was? Die Rolle gilt automatisch für alle Projekte der gewählten Marken.
          </p>
        </div>
        <InviteDialog brands={[...SDG_BRANDS]} />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {stat("Personen", users.length, `${users.filter((u) => u.role === "admin").length} Admins`)}
        <OnlineNow />
        {stat("Einladung offen", invited, invited ? "Noch nicht angemeldet" : "Alle sind angemeldet")}
      </div>

      <div className="mt-10">
        <UserList users={users} meId={me.id} allBrands={[...SDG_BRANDS]} />
      </div>
    </PageContainer>
  );
}
