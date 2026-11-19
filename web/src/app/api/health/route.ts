import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// Gleiche Einstellung wie die Seiten der App, damit dieselbe Server-Instanz
// geweckt wird (siehe (app)/layout.tsx).
export const maxDuration = 60;

/**
 * Wachhalte-Adresse: Ein externer Dienst ruft sie alle paar Minuten auf,
 * damit der Server nicht einschläft und Klicks nicht aufs Aufwachen warten.
 * Liefert keine Daten.
 */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
