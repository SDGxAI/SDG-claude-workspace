import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestHtmlIntoProject } from "@/lib/ingest/apply";

// Braucht Node (cheerio, service_role) und darf nicht statisch werden.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const header = req.headers.get("x-ingest-token");
  return header?.trim() || null;
}

/**
 * Claude-Schnittstelle: ersetzt die aktuelle Seite eines Projekts durch neues
 * HTML. Authentifizierung über den geheimen Update-Schlüssel des Projekts
 * (Header „Authorization: Bearer <schlüssel>" oder „x-ingest-token").
 *
 * Body (JSON): { "html": "<html>…", "filename"?: "…", "label"?: "…" }
 */
export async function POST(req: NextRequest) {
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Kein Update-Schlüssel übergeben." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Ungültiger JSON-Body." },
      { status: 400 },
    );
  }

  const data = body as { html?: unknown; filename?: unknown; label?: unknown };
  const html = typeof data.html === "string" ? data.html : "";
  const filename = typeof data.filename === "string" ? data.filename : undefined;
  const label = typeof data.label === "string" ? data.label : undefined;
  if (!html.trim()) {
    return NextResponse.json(
      { ok: false, error: "Feld „html“ fehlt oder ist leer." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, title")
    .eq("ingest_token", token)
    .maybeSingle();
  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Ungültiger Update-Schlüssel." },
      { status: 401 },
    );
  }

  const { data: page } = await admin
    .from("pages")
    .select("id")
    .eq("project_id", project.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!page) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Dieses Projekt hat noch keine Seite. Bitte zuerst einmalig eine Seite anlegen.",
      },
      { status: 409 },
    );
  }

  const result = await ingestHtmlIntoProject(admin, {
    pageId: page.id,
    projectId: project.id,
    html,
    filename,
    source: "claude",
    label: label ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  revalidatePath(`/projects/${project.id}`);
  return NextResponse.json({
    ok: true,
    project: project.title,
    projectId: project.id,
    savedVersion: result.versionNo,
    message: "Seite aktualisiert.",
  });
}
