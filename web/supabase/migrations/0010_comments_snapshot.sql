-- SDG Landingpage-Editor: Kommentare je Version festhalten
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0009).
--
-- Jede archivierte Version merkt sich, welche Kommentare zum Zeitpunkt der
-- Archivierung an der Seite hingen. So bleiben in alten Versionen die
-- (auch erledigten) Kommentare sichtbar, während die aktuelle Version nur
-- die noch offenen zeigt.

alter table page_versions
  add column if not exists comments_snapshot jsonb not null default '[]'::jsonb;
