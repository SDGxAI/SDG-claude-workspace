-- Ermöglicht das direkte Anlegen von Nutzer:innen in der App (mit vom
-- Admin vergebenem Passwort) und das Erzwingen einer Passwortänderung beim
-- ersten Login. Einmalig im Supabase SQL Editor ausführen.

alter table profiles
  add column if not exists must_change_password boolean not null default false;
