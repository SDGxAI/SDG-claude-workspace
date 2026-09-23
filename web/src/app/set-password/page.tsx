"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { completeOnboarding } from "@/lib/actions/invite";
import { SdgLogo } from "@/components/SdgLogo";

/**
 * Zielseite des Einladungslinks (und des ersten Logins mit Start-Passwort):
 * Die Person gibt ihren Vornamen ein und legt ihr Passwort fest.
 * Funktioniert nur mit gültiger Session aus dem Link (/auth/confirm setzt sie).
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      setHasSession(!!data.user);
      setSessionChecked(true);
      // Bereits hinterlegten Namen vorausfüllen (z. B. bei direkt angelegten Nutzern).
      if (data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", data.user.id)
          .maybeSingle();
        if (profile?.name) setFirstName(profile.name.split(" ")[0]);
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!firstName.trim()) {
      setError("Bitte gib deinen Vornamen ein.");
      return;
    }
    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (password !== passwordRepeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("Das Passwort konnte nicht gespeichert werden. Bitte versuche es erneut.");
      setLoading(false);
      return;
    }

    const res = await completeOnboarding(firstName);
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }

    router.push("/projects");
    router.refresh();
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20";

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <SdgLogo className="mb-6 h-6 w-auto" />
        <h1 className="text-xl font-semibold text-neutral-900">Zugang einrichten</h1>

        {!sessionChecked ? (
          <p className="mt-4 text-sm text-neutral-500">Einen Moment …</p>
        ) : !hasSession ? (
          <p className="mt-4 rounded-lg bg-sdg-red-light px-3 py-2 text-sm text-sdg-red-dark">
            Dieser Einladungslink ist ungültig oder abgelaufen. Bitte wende
            dich an deine:n Admin für eine neue Einladung.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="mt-1 text-sm text-neutral-500">
              Willkommen! Gib deinen Vornamen ein und lege dein Passwort fest
              (mindestens 8 Zeichen).
            </p>

            {error && (
              <p className="mt-4 rounded-lg bg-sdg-red-light px-3 py-2 text-sm text-sdg-red-dark">
                {error}
              </p>
            )}

            <label className="mt-6 block text-sm font-medium text-neutral-700">
              Vorname
              <input
                type="text"
                required
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-neutral-700">
              Passwort
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-neutral-700">
              Passwort wiederholen
              <input
                type="password"
                required
                autoComplete="new-password"
                value={passwordRepeat}
                onChange={(e) => setPasswordRepeat(e.target.value)}
                className={inputClass}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-lg bg-sdg-red px-4 py-2.5 font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
            >
              {loading ? "Wird gespeichert …" : "Zugang aktivieren"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
