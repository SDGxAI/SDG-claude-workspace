"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SdgLogo } from "@/components/SdgLogo";

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "auth"
      ? "Der Link ist ungültig oder abgelaufen. Bitte melde dich an oder fordere eine neue Einladung an."
      : null,
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "E-Mail-Adresse oder Passwort ist falsch."
          : "Anmeldung fehlgeschlagen. Bitte versuche es erneut.",
      );
      setLoading(false);
      return;
    }

    router.push("/projects");
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative w-full max-w-sm rounded-3xl border border-white bg-white/90 p-8 shadow-xl backdrop-blur"
    >
      <div className="flex flex-col items-center text-center">
        <SdgLogo className="h-7 w-auto" />
        <span className="mt-3 rounded-full bg-sdg-red-light px-2.5 py-0.5 text-xs font-semibold text-sdg-red">
          Sites
        </span>
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-neutral-900">Willkommen 👋</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Schön, dass du da bist. Melde dich mit deinem Zugang an.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-sdg-red-light px-3 py-2 text-sm text-sdg-red-dark">
          {error}
        </p>
      )}

      <label className="mt-6 block text-sm font-medium text-neutral-700">
        E-Mail-Adresse
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
        />
      </label>

      <label className="mt-4 block text-sm font-medium text-neutral-700">
        Passwort
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20"
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        className="mt-6 w-full rounded-full bg-sdg-red px-4 py-3 font-semibold text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {loading ? "Wird angemeldet …" : "Anmelden"}
      </button>
    </form>
  );
}

export function LoginForm() {
  return (
    <Suspense>
      <LoginFormInner />
    </Suspense>
  );
}
