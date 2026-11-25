/**
 * Aufräum-Regel für Versionen: Automatisch angelegte Versionen werden nach
 * RETENTION_DAYS Tagen gelöscht. Von Hand gespeicherte Versionen („Version
 * speichern“) und die KEEP_NEWEST neuesten Versionen je Seite bleiben immer.
 */
export const RETENTION_DAYS = 90;
export const KEEP_NEWEST = 5;

/** Welche Versionen einer Seite dürfen weg? `rows`: neueste zuerst. */
export function prunableVersions(
  rows: { id: string; source: string; created_at: string }[],
  now = Date.now(),
): string[] {
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return rows
    .slice(KEEP_NEWEST)
    .filter((v) => v.source !== "manual" && new Date(v.created_at).getTime() < cutoff)
    .map((v) => v.id);
}
