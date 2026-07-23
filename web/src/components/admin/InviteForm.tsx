"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteUser } from "@/lib/actions/invite";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const result = await inviteUser(email);
    if (result.ok) {
      setMessage({
        kind: "ok",
        text: `Einladung an ${email.trim()} wurde verschickt.`,
      });
      setEmail("");
      router.refresh();
    } else {
      setMessage({ kind: "error", text: result.error });
    }
    setLoading(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <input
        type="email"
        required
        placeholder="name@simba-dickie.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 sm:max-w-xs"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {loading ? "Wird verschickt …" : "Person einladen"}
      </button>
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
