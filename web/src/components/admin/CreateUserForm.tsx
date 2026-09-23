"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithPassword, type UserRole } from "@/lib/actions/invite";
import { BrandCheckboxes } from "@/components/admin/BrandCheckboxes";

export function CreateUserForm({ brands }: { brands: string[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("reviewer");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (
      role === "admin" &&
      !window.confirm(
        "Diese Person als Admin anlegen? Admins haben vollen Zugriff auf alle Projekte und können Nutzer verwalten.",
      )
    )
      return;
    setLoading(true);

    const result = await createUserWithPassword(email, password, name, role, selected);
    if (result.ok) {
      setMessage({
        kind: "ok",
        text: `${email.trim()} wurde angelegt. Bitte E-Mail und Passwort persönlich weitergeben – die Person legt beim ersten Login ein eigenes Passwort fest.`,
      });
      setEmail("");
      setName("");
      setPassword("");
      setSelected([]);
      setRole("reviewer");
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
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          required
          placeholder="Start-Passwort (mind. 8 Zeichen)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red sm:max-w-xs"
        >
          <option value="reviewer">Rolle: Reviewer (kommentieren)</option>
          <option value="editor">Rolle: Editor (bearbeiten)</option>
          <option value="admin">Rolle: Admin (alles)</option>
        </select>
      </div>

      {role === "admin" ? (
        <p className="text-sm text-neutral-500">
          Admins haben automatisch Zugriff auf alle Marken und Projekte.
        </p>
      ) : (
        <div>
          <p className="mb-1 text-sm font-medium text-neutral-700">
            Berechtigt für Marken{" "}
            <span className="font-normal text-neutral-400">
              (die Rolle gilt für alle gewählten Marken – auch neue Projekte)
            </span>
          </p>
          <BrandCheckboxes
            brands={brands}
            selected={selected}
            onChange={setSelected}
            disabled={loading}
          />
        </div>
      )}

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
