-- SDG Landingpage-Editor: Update-Schlüssel für die Claude-Schnittstelle
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0007).
--
-- Jedes Projekt kann einen geheimen Schlüssel bekommen. Wer den Schlüssel
-- kennt, darf über die API (POST /api/ingest) die aktuelle Seite des Projekts
-- ersetzen. So kann ein verbundener Claude fertige Seiten direkt einspielen.

alter table projects add column if not exists ingest_token text;

create unique index if not exists projects_ingest_token_idx
  on projects (ingest_token)
  where ingest_token is not null;
