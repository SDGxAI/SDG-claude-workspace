"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteShopifyConnection,
  saveShopifyConnection,
  startShopifyAuthorization,
  testShopifyConnection,
  type ShopifyConnectionInfo,
} from "@/lib/actions/shopify";

const INPUT =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20";

type Msg = { kind: "ok" | "error"; text: string } | null;

function ConnectionForm({
  existing,
  onDone,
}: {
  existing?: ShopifyConnectionInfo;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [domain, setDomain] = useState(existing?.shopDomain ?? "");
  const [authType, setAuthType] = useState<"client" | "token">(
    existing?.authType === "token" ? "token" : "client",
  );
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await saveShopifyConnection({
      id: existing?.id,
      name,
      shopDomain: domain,
      clientId: authType === "client" ? clientId : undefined,
      clientSecret: authType === "client" ? clientSecret : undefined,
      accessToken: authType === "token" ? token : undefined,
      storefrontPassword: password,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "error", text: res.error });
      return;
    }
    setMsg({ kind: "ok", text: `Verbunden mit „${res.shopName}“.` });
    router.refresh();
    onDone();
  }

  async function authorize() {
    setBusy(true);
    setMsg(null);
    const res = await startShopifyAuthorization({
      id: existing?.id,
      name,
      shopDomain: domain,
      clientId,
      clientSecret,
      storefrontPassword: password,
    });
    if (!res.ok) {
      setBusy(false);
      setMsg({ kind: "error", text: res.error });
      return;
    }
    // Weiter zu Shopify: dort Installation bestätigen, danach geht es zurück.
    window.location.href = res.url;
  }

  const editing = !!existing;
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-neutral-700">
          Anzeigename
          <input
            className={`mt-1 ${INPUT}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Simba Shop DE"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-700">
          Shop-Adresse
          <input
            className={`mt-1 ${INPUT}`}
            required
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="name.myshopify.com"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-neutral-700">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={authType === "client"}
            onChange={() => setAuthType("client")}
            className="accent-sdg-red"
          />
          App aus dem Dev Dashboard (Client-ID + Secret)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={authType === "token"}
            onChange={() => setAuthType("token")}
            className="accent-sdg-red"
          />
          Ältere Shop-App (Zugriffstoken shpat_…)
        </label>
      </div>

      {authType === "client" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-neutral-700">
            Client-ID
            <input
              className={`mt-1 ${INPUT}`}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={editing ? "unverändert lassen" : ""}
              required={!editing}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm font-medium text-neutral-700">
            Client-Secret
            <input
              type="password"
              className={`mt-1 ${INPUT}`}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={editing ? "unverändert lassen" : ""}
              required={!editing}
              autoComplete="new-password"
            />
          </label>
        </div>
      ) : (
        <label className="block text-sm font-medium text-neutral-700">
          Admin-API-Zugriffstoken
          <input
            type="password"
            className={`mt-1 ${INPUT}`}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={editing ? "unverändert lassen" : "shpat_…"}
            required={!editing}
            autoComplete="new-password"
          />
        </label>
      )}

      <label className="block text-sm font-medium text-neutral-700">
        Onlineshop-Passwort <span className="font-normal text-neutral-400">(solange der Shop nicht live ist)</span>
        <input
          type="password"
          className={`mt-1 ${INPUT} sm:max-w-xs`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={editing && existing?.hasPassword ? "unverändert lassen" : "optional"}
          autoComplete="new-password"
        />
      </label>

      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-sdg-red-light text-sdg-red-dark"
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {authType === "client" && (
          <button
            type="button"
            onClick={authorize}
            disabled={busy || !domain.trim()}
            className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
            title="Öffnet Shopify: dort die Installation bestätigen, danach geht es automatisch zurück"
          >
            {busy ? "Bitte warten …" : "Über Shopify freigeben ↗"}
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className={
            authType === "client"
              ? "rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
              : "rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
          }
        >
          {busy ? "Verbindung wird geprüft …" : editing ? "Speichern & prüfen" : "Shop verbinden"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
          >
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

function ConnectionRow({ c }: { c: ShopifyConnectionInfo }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function test() {
    setBusy(true);
    setMsg(null);
    const res = await testShopifyConnection(c.id);
    setBusy(false);
    setMsg(res.ok ? { kind: "ok", text: res.message } : { kind: "error", text: res.error });
  }

  async function remove() {
    if (
      !window.confirm(
        `Verbindung zu „${c.name}“ entfernen? Projekte aus diesem Shop können dann nicht mehr per KI geändert werden.`,
      )
    )
      return;
    setBusy(true);
    const res = await deleteShopifyConnection(c.id);
    setBusy(false);
    if (!res.ok) setMsg({ kind: "error", text: res.error });
    else router.refresh();
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium text-neutral-900">{c.name}</span>
        <span className="text-sm text-neutral-500">{c.shopDomain}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
          {c.authType === "oauth"
            ? "Über Shopify freigegeben"
            : c.authType === "client"
              ? "Dev-Dashboard-App"
              : "Zugriffstoken"}
        </span>
        {c.hasPassword && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
            Shop-Passwort hinterlegt
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <button onClick={test} disabled={busy} className="text-neutral-600 hover:text-sdg-red disabled:opacity-50">
            {busy ? "…" : "Testen"}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={busy}
            className="text-neutral-600 hover:text-sdg-red disabled:opacity-50"
          >
            Bearbeiten
          </button>
          <button onClick={remove} disabled={busy} className="text-neutral-400 hover:text-sdg-red disabled:opacity-50">
            Entfernen
          </button>
        </div>
      </div>
      {msg && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-sdg-red-light text-sdg-red-dark"
          }`}
        >
          {msg.text}
        </p>
      )}
      {editing && (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <ConnectionForm existing={c} onDone={() => setEditing(false)} />
        </div>
      )}
    </div>
  );
}

export function ShopifyConnections({ connections }: { connections: ShopifyConnectionInfo[] }) {
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-medium text-neutral-900">Shop verbinden</h2>
        <p className="mb-4 mt-1 text-sm text-neutral-500">
          Empfohlen: <strong>„Über Shopify freigeben“</strong> – Shopify zeigt dir die Berechtigungen,
          du bestätigst die Installation und landest wieder hier. Zugangsdaten bleiben auf dem Server
          und werden nie im Browser angezeigt.
        </p>
        <ConnectionForm key={formKey} onDone={() => setFormKey((k) => k + 1)} />
      </section>

      <section className="mt-6">
        <h2 className="font-medium text-neutral-900">Verbundene Shops ({connections.length})</h2>
        <div className="mt-3 space-y-3">
          {connections.length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
              Noch kein Shop verbunden.
            </p>
          )}
          {connections.map((c) => (
            <ConnectionRow key={c.id} c={c} />
          ))}
        </div>
      </section>
    </>
  );
}
