-- SDG Landingpage-Editor: Anwesenheit („zuletzt gesehen")
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0013).
--
-- Die App aktualisiert diesen Zeitstempel regelmäßig, während jemand die App
-- offen hat. Admins sehen so, wer gerade online ist.

alter table profiles add column if not exists last_seen_at timestamptz;
