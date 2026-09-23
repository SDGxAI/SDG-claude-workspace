"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteUser, type AccessRole } from "@/lib/actions/invite";
import { BrandCheckboxes } from "@/components/admin/BrandCheckboxes";

export function InviteForm({ brands }: { brands: string[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AccessRole>("reviewer");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const result = await inviteUser(email, name, role, selected);
    if (result.ok) {
      setMessage({
        kind: "ok",
        text: `Einladung an ${email.trim()} wurde verschickt.`,
      });
      setEmail("");
      setName("");
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
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-[10rem]"
        />
        <input
          type="email"
          required
          placeholder="name@simba-dickie.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AccessRole)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red sm:max-w-[12rem]"
        >
          <option value="reviewer">Reviewer</option>
          <option value="editor">Editor</option>
        </select>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700">
          Berechtigt für Marken
        </p>
        <BrandCheckboxes
          brands={brands}
          selected={selected}
          onChange={setSelected}
          disabled={loading}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {loading ? "Wird verschickt …" : "Person einladen"}
      </button>

      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-green-700" : "text-sdg-red-dark"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
