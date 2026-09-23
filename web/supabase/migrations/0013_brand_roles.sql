-- SDG Landingpage-Editor: Rechte pro Marke + Name
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0012).
--
-- Neu: Rechte werden pro Marke vergeben (Reviewer/Editor) und gelten
-- automatisch für ALLE Projekte dieser Marke – auch neue. Kein Freischalten
-- pro Projekt mehr nötig. Zusätzlich ein Namensfeld für die Anrede.

alter table profiles add column if not exists name text;

create table if not exists user_brand_roles (
  user_id uuid not null references profiles (id) on delete cascade,
  brand text not null,
  role project_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, brand)
);

alter table user_brand_roles enable row level security;

drop policy if exists "ubr_select" on user_brand_roles;
create policy "ubr_select" on user_brand_roles for select
  using (user_id = auth.uid() or is_admin());
drop policy if exists "ubr_insert" on user_brand_roles;
create policy "ubr_insert" on user_brand_roles for insert with check (is_admin());
drop policy if exists "ubr_update" on user_brand_roles;
create policy "ubr_update" on user_brand_roles for update using (is_admin());
drop policy if exists "ubr_delete" on user_brand_roles;
create policy "ubr_delete" on user_brand_roles for delete using (is_admin());

-- Zugriff auf ein Projekt: Admin, ODER passende Marken-Rolle, ODER (Alt-Weg)
-- eine explizite Projekt-Mitgliedschaft.
create or replace function is_project_member(p_project_id uuid, p_min_role project_role default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    is_admin()
    or exists (
      select 1 from user_brand_roles ubr
      join projects pr on pr.id = p_project_id
      where ubr.user_id = auth.uid() and ubr.brand = pr.brand
        and (
          p_min_role is null
          or (p_min_role = 'viewer'   and ubr.role in ('viewer','reviewer','editor'))
          or (p_min_role = 'reviewer' and ubr.role in ('reviewer','editor'))
          or (p_min_role = 'editor'   and ubr.role = 'editor')
        )
    )
    or exists (
      select 1 from project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid()
        and (
          p_min_role is null
          or (p_min_role = 'viewer'   and pm.role in ('viewer','reviewer','editor'))
          or (p_min_role = 'reviewer' and pm.role in ('reviewer','editor'))
          or (p_min_role = 'editor'   and pm.role = 'editor')
        )
    );
$$;

-- Effektive Rolle der eingeloggten Person für ein Projekt (höchste Rolle aus
-- Marken-Rolle und Projekt-Mitgliedschaft), 'editor' für Admins, sonst NULL.
create or replace function effective_project_role(p_project_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case when is_admin() then 'editor'
  else (
    select r.role from (
      select ubr.role::text as role,
        case ubr.role when 'editor' then 3 when 'reviewer' then 2 else 1 end as rank
      from user_brand_roles ubr join projects pr on pr.id = p_project_id
      where ubr.user_id = auth.uid() and ubr.brand = pr.brand
      union all
      select pm.role::text,
        case pm.role when 'editor' then 3 when 'reviewer' then 2 else 1 end
      from project_members pm
      where pm.project_id = p_project_id and pm.user_id = auth.uid()
    ) r order by r.rank desc limit 1
  ) end;
$$;
