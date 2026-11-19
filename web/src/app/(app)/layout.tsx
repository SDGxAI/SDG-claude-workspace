import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { listNotifications } from "@/lib/actions/notifications";
import { AppSidebar } from "@/components/AppSidebar";
import { PresencePinger } from "@/components/PresencePinger";

// Einheitliche Server-Einstellung für alle Seiten der App (Projektseite und
// KI brauchen bis zu 60 s). So laufen die Seiten auf derselben warmen
// Server-Instanz, die auch /api/health wach hält.
export const maxDuration = 60;

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
  // Profil und Mitteilungen gleichzeitig laden (spart eine Wartezeit je Klick).
  const [profile, notifications] = await Promise.all([getCurrentProfile(), listNotifications(15)]);

  if (!profile) {
    redirect("/login");
  }

  // Direkt angelegte Nutzer:innen müssen beim ersten Login ein eigenes
  // Passwort festlegen (die Zielseite liegt außerhalb dieses Layouts).
  if (profile.must_change_password) {
    redirect("/set-password");
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col lg:flex-row">
      <AppSidebar
        name={profile.name}
        email={profile.email ?? ""}
        isAdmin={profile.is_admin}
        avatarUrl={profile.avatar_url}
        notifications={notifications}
      />
      <PresencePinger />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
