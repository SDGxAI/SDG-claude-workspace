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
    .select("email, is_admin")
    .eq("id", user.id)
    .single();

  return (
    <>
      <AppHeader
        email={profile?.email ?? user.email ?? ""}
        isAdmin={profile?.is_admin ?? false}
      />
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  );
}
