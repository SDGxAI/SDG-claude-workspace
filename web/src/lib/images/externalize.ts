import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Eingebettete Bilder (data:image/…;base64,…) aus Seiten herauslösen.
 *
 * Von Claude erzeugte Seiten betten Bilder oft direkt ins HTML ein – eine Seite
 * wird dadurch schnell 2 MB groß. Jede Anzeige, jedes Speichern und jede
 * KI-Anfrage schiebt diese Datenmenge mehrfach hin und her (zäh, und der Editor
 * rutscht über die 4,5-MB-Grenze des Hostings). Deshalb werden größere
 * eingebettete Bilder in den Bilder-Speicher hochgeladen und im HTML durch ihre
 * Adresse ersetzt. Gleiche Bilder bekommen dieselbe Datei (Inhalts-Hash).
 */

const BUCKET = "ki-assets";
/** Kleine Icons bleiben eingebettet (Zeichenlänge des Base64-Teils). */
const MIN_BASE64_CHARS = 6000;
const DATA_IMAGE_RE = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/** Enthält der Text große eingebettete Bilder? */
export function hasLargeInlineImages(text: string): boolean {
  for (const m of text.matchAll(DATA_IMAGE_RE)) {
    if (m[2].length >= MIN_BASE64_CHARS) return true;
  }
  return false;
}

export interface Externalized {
  /** Ersetzt alle hochgeladenen Bilder in einem Text durch ihre Adresse. */
  replace: (text: string) => string;
  uploaded: number;
}

/**
 * Lädt alle großen eingebetteten Bilder aus den Texten hoch und liefert eine
 * Ersetzungsfunktion. Schlägt ein Upload fehl, bleibt das Bild eingebettet.
 */
export async function externalizeInlineImages(
  projectId: string,
  texts: string[],
): Promise<Externalized> {
  const unique = new Map<string, { mime: string; b64: string }>();
  for (const text of texts) {
    for (const m of text.matchAll(DATA_IMAGE_RE)) {
      if (m[2].length >= MIN_BASE64_CHARS && !unique.has(m[0])) {
        unique.set(m[0], { mime: m[1].toLowerCase(), b64: m[2] });
      }
    }
  }
  const urlByUri = new Map<string, string>();
  if (unique.size === 0) return { replace: (t) => t, uploaded: 0 };

  const admin = createAdminClient();
  const entries = [...unique.entries()];
  for (let i = 0; i < entries.length; i += 6) {
    await Promise.all(
      entries.slice(i, i + 6).map(async ([uri, { mime, b64 }]) => {
        try {
          const bytes = Buffer.from(b64, "base64");
          const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
          const path = `${projectId}/inline/${hash}.${EXT[mime] ?? "png"}`;
          const { error } = await admin.storage
            .from(BUCKET)
            .upload(path, bytes, { contentType: mime, upsert: true });
          if (error) return;
          const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
          if (data?.publicUrl) urlByUri.set(uri, data.publicUrl);
        } catch {
          /* Bild bleibt eingebettet */
        }
      }),
    );
  }

  return {
    replace: (text: string) =>
      urlByUri.size === 0 ? text : text.replace(DATA_IMAGE_RE, (m) => urlByUri.get(m) ?? m),
    uploaded: urlByUri.size,
  };
}

/** Wendet die Ersetzung auf einen JSON-Wert an (über seine Textform). */
export function replaceInJson<T>(value: T, replace: (text: string) => string): T {
  return JSON.parse(replace(JSON.stringify(value))) as T;
}

/**
 * Bestehende Seite (und ggf. ihren KI-Entwurf) nachträglich verschlanken.
 * Wird beim Öffnen von Projekt, Editor und KI-Bearbeiten aufgerufen; ist
 * nichts zu tun, kostet es nur eine kleine Abfrage.
 */
export async function slimDownPage(pageId: string, projectId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: pageHit }, { data: draftHit }] = await Promise.all([
      admin.from("pages").select("id").eq("id", pageId).like("template_html", "%;base64,%").maybeSingle(),
      admin.from("page_drafts").select("page_id").eq("page_id", pageId).like("html", "%;base64,%").maybeSingle(),
    ]);
    if (!pageHit && !draftHit) return;

    const [{ data: page }, { data: draft }] = await Promise.all([
      pageHit
        ? admin.from("pages").select("template_html, content_state, detected_elements").eq("id", pageId).single()
        : Promise.resolve({ data: null }),
      draftHit
        ? admin.from("page_drafts").select("html").eq("page_id", pageId).single()
        : Promise.resolve({ data: null }),
    ]);

    const texts: string[] = [];
    const pageNeeds =
      !!page &&
      (hasLargeInlineImages(page.template_html) ||
        hasLargeInlineImages(JSON.stringify(page.content_state)) ||
        hasLargeInlineImages(JSON.stringify(page.detected_elements)));
    const draftNeeds = !!draft && hasLargeInlineImages(draft.html);
    if (!pageNeeds && !draftNeeds) return;
    if (pageNeeds && page) {
      texts.push(page.template_html, JSON.stringify(page.content_state), JSON.stringify(page.detected_elements));
    }
    if (draftNeeds && draft) texts.push(draft.html);

    const ext = await externalizeInlineImages(projectId, texts);
    if (ext.uploaded === 0) return;

    // War der Entwurf schon vorher veraltet (Seite neuer als Entwurf)?
    const [{ data: pageTime }, { data: draftTime }] = await Promise.all([
      admin.from("pages").select("updated_at").eq("id", pageId).maybeSingle(),
      admin.from("page_drafts").select("updated_at").eq("page_id", pageId).maybeSingle(),
    ]);
    const draftWasStale =
      !!pageTime?.updated_at &&
      !!draftTime?.updated_at &&
      new Date(pageTime.updated_at).getTime() > new Date(draftTime.updated_at).getTime();

    const now = new Date().toISOString();
    if (pageNeeds && page) {
      await admin
        .from("pages")
        .update({
          template_html: ext.replace(page.template_html),
          content_state: replaceInJson(page.content_state, ext.replace),
          detected_elements: replaceInJson(page.detected_elements, ext.replace),
        })
        .eq("id", pageId);
    }
    // Entwurf mitziehen – und als „aktuell“ markieren, damit er nicht als
    // veraltet gilt (die Seite wurde ja nur verschlankt, nicht geändert).
    const { data: draftRow } = await admin
      .from("page_drafts")
      .select("html")
      .eq("page_id", pageId)
      .maybeSingle();
    if (draftRow) {
      await admin
        .from("page_drafts")
        .update({ html: ext.replace(draftRow.html), ...(draftWasStale ? {} : { updated_at: now }) })
        .eq("page_id", pageId);
    }
  } catch {
    /* Verschlanken ist Optimierung – nie blockierend. */
  }
}
