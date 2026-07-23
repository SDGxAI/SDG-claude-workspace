"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithPassword } from "@/lib/actions/invite";
import { BrandCheckboxes } from "@/components/admin/BrandCheckboxes";

export function CreateUserForm({ brands }: { brands: string[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const result = await createUserWithPassword(email, password, selectedBrands);
    if (result.ok) {
      setMessage({
        kind: "ok",
        text: `${email.trim()} wurde angelegt. Bitte E-Mail und Passwort persönlich weitergeben – die Person wird beim ersten Login zur Passwortänderung aufgefordert.`,
      });
      setEmail("");
      setPassword("");
      setSelectedBrands([]);
      router.refresh();
    } else {
      setMessage({ kind: "error", text: result.error });
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          placeholder="name@simba-dickie.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
        />
        <input
          type="text"
          required
          placeholder="Start-Passwort (mind. 8 Zeichen)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
        />
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700">
          Berechtigt für Firma/Marke{" "}
          <span className="font-normal text-neutral-400">
            (nichts auswählen = Zugriff auf alle Marken)
          </span>
        </p>
        <BrandCheckboxes
          brands={brands}
          selected={selectedBrands}
          onChange={setSelectedBrands}
          disabled={loading}
        />
      </div>

      <div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
        >
          {loading ? "Wird angelegt …" : "Nutzer anlegen"}
        </button>
      </div>

      {message && (
        <p
          className={`text-sm ${
            message.kind === "ok" ? "text-green-700" : "text-sdg-red-dark"
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
