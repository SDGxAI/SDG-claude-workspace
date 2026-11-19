import { NextResponse, type NextRequest } from "next/server";
import { getProjectAccess } from "@/lib/access";
import { cleanHtml } from "@/lib/page/html";
import { loadPage } from "@/lib/page/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Die Seite eines Projekts für das Vorschaubild auf der Projektkachel.
 * Wird in einem abgeschotteten Fenster ohne Skripte angezeigt.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getProjectAccess(id);
  if (!access?.role) return new NextResponse("Kein Zugriff.", { status: 403 });
  const page = await loadPage(id);
  if (!page) return new NextResponse("", { status: 404 });
  return new NextResponse(cleanHtml(page.html), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Keine Skripte, keine Formulare – nur ansehen.
      "Content-Security-Policy": "script-src 'none'; form-action 'none'; frame-ancestors 'self'",
      "Cache-Control": "private, max-age=120",
    },
  });
}
