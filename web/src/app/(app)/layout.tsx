import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";

/**
 * Layout für alle eingeloggten Bereiche: prüft die Session und lädt das
 * Profil (E-Mail, Admin-Flag) für die Kopfzeile. Nicht eingeloggte
 * Besucher:innen landen auf /login.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, is_admin, must_change_password, avatar_url")
    .eq("id", user.id)
    .single();

  // Direkt angelegte Nutzer:innen müssen beim ersten Login ein eigenes
  // Passwort festlegen (die Zielseite liegt außerhalb dieses Layouts).
  if (profile?.must_change_password) {
    redirect("/set-password");
  }

  return (
    <>
      <AppHeader
        email={profile?.email ?? user.email ?? ""}
        isAdmin={profile?.is_admin ?? false}
        avatarUrl={profile?.avatar_url ?? null}
      />
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  );
}
