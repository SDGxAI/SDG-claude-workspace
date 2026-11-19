"use client";

import { useEffect, useState } from "react";
import { pingServer, type PingResult } from "@/lib/actions/tempo";

interface Props {
  region: string;
  instanceAgeS: number;
  steps: { label: string; ms: number; note?: string }[];
}

const color = (ms: number) => (ms < 300 ? "text-emerald-700" : ms < 1000 ? "text-amber-700" : "text-sdg-red");

export function TempoClient({ region, instanceAgeS, steps }: Props) {
  const [load, setLoad] = useState<{ ttfb: number; total: number } | null>(null);
  const [pings, setPings] = useState<(PingResult & { totalMs: number })[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) setLoad({ ttfb: Math.round(nav.responseStart - nav.startTime), total: Math.round(nav.duration || performance.now()) });
  }, []);

  async function measure() {
    setBusy(true);
    const out: (PingResult & { totalMs: number })[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const r = await pingServer();
      if (r) out.push({ ...r, totalMs: Math.round(performance.now() - t) });
    }
    setPings(out);
    setBusy(false);
  }

  const card = "rounded-3xl border border-white bg-white/90 p-6 shadow-sm";
  const sum = steps.reduce((n, s) => n + s.ms, 0);

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-2">
      <section className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Server</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Region der App</dt>
            <dd className="font-mono font-semibold">{region}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Server läuft seit</dt>
            <dd className="font-mono">{instanceAgeS} s {instanceAgeS < 15 ? "(gerade aufgewacht)" : ""}</dd>
          </div>
          {load && (
            <>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Bis zur ersten Antwort (diese Seite)</dt>
                <dd className={`font-mono font-semibold ${color(load.ttfb)}`}>{load.ttfb} ms</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Seite komplett geladen</dt>
                <dd className={`font-mono ${color(load.total)}`}>{load.total} ms</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Schritte auf dem Server</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {steps.map((s) => (
            <li key={s.label} className="flex justify-between gap-3">
              <span className="text-neutral-700">
                {s.label}
                {s.note && <span className="text-neutral-400"> · {s.note}</span>}
              </span>
              <span className={`font-mono font-semibold ${color(s.ms)}`}>{s.ms} ms</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-neutral-100 pt-2 font-semibold">
            <span>Summe</span>
            <span className={`font-mono ${color(sum)}`}>{sum} ms</span>
          </li>
        </ul>
      </section>

      <section className={`${card} lg:col-span-2`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Klick-Test (5 kleine Anfragen)</h2>
          <button
            onClick={measure}
            disabled={busy}
            className="rounded-full bg-sdg-red px-5 py-2 text-sm font-semibold text-white hover:bg-sdg-red-dark disabled:opacity-60"
          >
            {busy ? "Misst …" : "Messen"}
          </button>
        </div>
        {pings.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-neutral-400">
              <tr>
                <th className="pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Gesamt (Klick → Antwort)</th>
                <th className="pb-2 font-medium">davon Server</th>
                <th className="pb-2 font-medium">Weg / Warten</th>
                <th className="pb-2 font-medium">Region</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {pings.map((p, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1.5">{i + 1}</td>
                  <td className={`py-1.5 font-semibold ${color(p.totalMs)}`}>{p.totalMs} ms</td>
                  <td className={`py-1.5 ${color(p.serverMs)}`}>{p.serverMs} ms</td>
                  <td className={`py-1.5 ${color(p.totalMs - p.serverMs)}`}>{p.totalMs - p.serverMs} ms</td>
                  <td className="py-1.5">{p.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
