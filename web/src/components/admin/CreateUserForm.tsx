"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithPassword } from "@/lib/actions/invite";
import { BrandRoleRows, type BrandRoleMap } from "@/components/admin/BrandRoleRows";
import type { ProjectRole } from "@/types/database";

export function CreateUserForm({ brands }: { brands: string[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [map, setMap] = useState<BrandRoleMap>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  function change(brand: string, role: ProjectRole | null) {
    setMap((prev) => {
      const next = { ...prev };
      if (role === null) delete next[brand];
      else next[brand] = role;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const brandRoles = Object.entries(map).map(([brand, role]) => ({ brand, role }));
    const result = await createUserWithPassword(email, password, name, brandRoles);
    if (result.ok) {
      setMessage({
        kind: "ok",
        text: `${email.trim()} wurde angelegt. Bitte E-Mail und Passwort persönlich weitergeben – die Person legt beim ersten Login ein eigenes Passwort fest.`,
      });
      setEmail("");
      setName("");
      setPassword("");
      setMap({});
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
          type="text"
          required
          placeholder="Name (z. B. Yannick Lockowandt)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
        />
        <input
          type="email"
          required
          placeholder="name@simba-dickie.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
        />
      </div>
      <input
        type="text"
        required
        placeholder="Start-Passwort (mind. 8 Zeichen)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
      />

      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700">
          Marken &amp; Rollen{" "}
          <span className="font-normal text-neutral-400">
            (gilt automatisch für alle Projekte der Marke)
          </span>
        </p>
        <BrandRoleRows brands={brands} value={map} onChange={change} disabled={loading} />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {loading ? "Wird angelegt …" : "Nutzer anlegen"}
      </button>

      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-green-700" : "text-sdg-red-dark"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
