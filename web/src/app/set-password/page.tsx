"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearMustChangePassword } from "@/lib/actions/invite";

/**
 * Zielseite des Einladungslinks: die eingeladene Person legt hier ihr
 * Passwort fest. Funktioniert nur mit gültiger Session aus dem Link
 * (/auth/confirm setzt sie).
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user);
      setSessionChecked(true);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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

    // Falls die Person direkt angelegt wurde: erzwungenen Wechsel abhaken.
    await clearMustChangePassword();

    router.push("/projects");
    router.refresh();
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">
          Passwort festlegen
        </h1>

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
              Willkommen! Lege dein Passwort fest (mindestens 8 Zeichen), um
              den Zugang zu aktivieren.
            </p>

            {error && (
              <p className="mt-4 rounded-lg bg-sdg-red-light px-3 py-2 text-sm text-sdg-red-dark">
                {error}
              </p>
            )}

            <label className="mt-6 block text-sm font-medium text-neutral-700">
              Neues Passwort
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
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
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-lg bg-sdg-red px-4 py-2.5 font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
            >
              {loading ? "Wird gespeichert …" : "Passwort speichern"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
