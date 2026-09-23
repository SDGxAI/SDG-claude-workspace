"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteUser, type UserRole } from "@/lib/actions/invite";
import { BrandCheckboxes } from "@/components/admin/BrandCheckboxes";

export function InviteForm({ brands }: { brands: string[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("reviewer");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setFallbackLink(null);
    setCopied(false);

    if (
      role === "admin" &&
      !window.confirm(
        "Diese Person als Admin einladen? Admins haben vollen Zugriff auf alle Projekte und können Nutzer verwalten.",
      )
    )
      return;

    setLoading(true);
    const result = await inviteUser(email, role, selected);
    if (result.ok) {
      if (result.emailed) {
        setMessage({
          kind: "ok",
          text: `Einladung an ${email.trim()} wurde per E-Mail verschickt.`,
        });
      } else {
        setMessage({
          kind: "error",
          text: `Zugang für ${email.trim()} wurde angelegt, aber die E-Mail ging nicht raus (${result.note}). Gib den Link unten bitte persönlich weiter.`,
        });
        setFallbackLink(result.link);
      }
      setEmail("");
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
          type="email"
          required
          placeholder="name@simba-dickie.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red sm:max-w-[14rem]"
        >
          <option value="reviewer">Reviewer (kommentieren)</option>
          <option value="editor">Editor (bearbeiten)</option>
          <option value="admin">Admin (alles)</option>
        </select>
      </div>

      {role === "admin" ? (
        <p className="text-sm text-neutral-500">
          Admins haben automatisch Zugriff auf alle Marken und Projekte.
        </p>
      ) : (
        <div>
          <p className="mb-1 text-sm font-medium text-neutral-700">Berechtigt für Marken</p>
          <BrandCheckboxes
            brands={brands}
            selected={selected}
            onChange={setSelected}
            disabled={loading}
          />
        </div>
      )}

      <p className="text-xs text-neutral-400">
        Die Person bekommt eine E-Mail und trägt beim Einrichten des Zugangs
        selbst ihren Vornamen und ihr Passwort ein.
      </p>

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
      {fallbackLink && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700">
            {fallbackLink}
          </code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fallbackLink);
                setCopied(true);
              } catch {
                /* Zwischenablage nicht verfügbar */
              }
            }}
            className="rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600 hover:border-sdg-red hover:text-sdg-red"
          >
            {copied ? "Kopiert ✓" : "Link kopieren"}
          </button>
        </div>
      )}
    </form>
  );
}
