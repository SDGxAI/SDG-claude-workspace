"use server";

import { getCurrentProfile } from "@/lib/auth";

/** Wann diese Server-Instanz gestartet ist (frisch gestartet = „Aufwachen“). */
const BOOTED_AT = Date.now();

export interface PingResult {
  region: string;
  serverMs: number;
  instanceAgeS: number;
}

/** Kleinste mögliche Anfrage an den Server – misst Weg + Aufwachen. */
export async function pingServer(): Promise<PingResult | null> {
  const start = Date.now();
  const me = await getCurrentProfile();
  if (!me?.is_admin) return null;
  return {
    region: process.env.VERCEL_REGION ?? "lokal",
    serverMs: Date.now() - start,
    instanceAgeS: Math.round((Date.now() - BOOTED_AT) / 1000),
  };
}
