import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";

/**
 * Layout für alle eingeloggten Bereiche: prüft die Session und lädt das
 * Profil (E-Mail, Admin-Flag) für die Kopfzeile. Nicht eingeloggte
 * Besucher:innen landen auf /login.
 *
 * Profil/Nutzer werden über `getCurrentProfile` geladen – pro Request
 * memoisiert, sodass die untergeordneten Seiten dieselben Daten ohne
 * zusätzlichen Netzwerk-Roundtrip wiederverwenden.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // Direkt angelegte Nutzer:innen müssen beim ersten Login ein eigenes
  // Passwort festlegen (die Zielseite liegt außerhalb dieses Layouts).
  if (profile.must_change_password) {
    redirect("/set-password");
  }

  return (
    <>
      <AppHeader
        email={profile.email ?? ""}
        isAdmin={profile.is_admin}
        avatarUrl={profile.avatar_url}
      />
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  );
}
