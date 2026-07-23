"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (password.length < 8) {
      setMessage({ kind: "error", text: "Das Passwort muss mindestens 8 Zeichen lang sein." });
      return;
    }
    if (password !== passwordRepeat) {
      setMessage({ kind: "error", text: "Die beiden Passwörter stimmen nicht überein." });
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setMessage({
        kind: "error",
        text: "Das Passwort konnte nicht geändert werden. Bitte versuche es erneut.",
      });
      return;
    }

    setPassword("");
    setPasswordRepeat("");
    setMessage({ kind: "ok", text: "Passwort erfolgreich geändert." });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-neutral-200 bg-white p-6"
    >
      <h2 className="font-semibold text-neutral-900">Passwort ändern</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Mindestens 8 Zeichen.
      </p>

      {message && (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            message.kind === "ok"
              ? "bg-green-100 text-green-800"
              : "bg-sdg-red-light text-sdg-red-dark"
          }`}
        >
          {message.text}
        </p>
      )}

      <label className="mt-4 block text-sm font-medium text-neutral-700">
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
        className="mt-6 rounded-lg bg-sdg-red px-4 py-2.5 font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {loading ? "Wird gespeichert …" : "Passwort speichern"}
      </button>
    </form>
  );
}
