-- Nutzer:innen können auf bestimmte Marken (Firmen) beschränkt werden.
-- Ist mindestens eine Marke gesetzt, sieht/bearbeitet die Person NUR Projekte
-- dieser Marke(n) - unabhängig von einer Projekt-Zuweisung. Ist keine Marke
-- gesetzt, gilt keine Marken-Einschränkung. Admins sind nie eingeschränkt.
-- Einmalig im Supabase SQL Editor ausführen.

alter table profiles
  add column if not exists brands text[] not null default '{}';

-- is_project_member um die Marken-Einschränkung erweitern. Diese Funktion
-- wird von allen Zugriffsregeln (Projekte, Seiten, Snapshots, Kommentare,
-- Bild-Storage) genutzt, daher wirkt die Einschränkung überall.
create or replace function is_project_member(p_project_id uuid, p_min_role project_role default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from profiles where id = auth.uid() and is_admin)
    or exists (
      select 1
      from project_members pm
      join projects pr on pr.id = pm.project_id
      join profiles pf on pf.id = auth.uid()
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
        and (
          p_min_role is null
          or (p_min_role = 'viewer' and pm.role in ('viewer', 'reviewer', 'editor'))
          or (p_min_role = 'reviewer' and pm.role in ('reviewer', 'editor'))
          or (p_min_role = 'editor' and pm.role = 'editor')
        )
        and (cardinality(pf.brands) = 0 or pr.brand = any(pf.brands))
    );
$$;
