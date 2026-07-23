import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/PageContainer";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, is_admin")
    .eq("id", user.id)
    .single();

  return (
    <PageContainer>
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold text-neutral-900">Mein Profil</h1>

        <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="font-semibold text-neutral-900">Konto</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">E-Mail-Adresse</dt>
              <dd className="text-neutral-900">{profile?.email ?? user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Rolle</dt>
              <dd className="text-neutral-900">
                {profile?.is_admin ? "Admin" : "Nutzer:in"}
              </dd>
            </div>
          </dl>
        </section>

        <div className="mt-6">
          <ChangePasswordForm />
        </div>
      </div>
    </PageContainer>
  );
}
