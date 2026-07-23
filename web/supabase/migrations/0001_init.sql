-- SDG Landingpage-Editor: Basis-Schema
-- Führe diese Datei einmalig im Supabase SQL Editor aus (Dashboard ->
-- SQL Editor -> New query -> Inhalt einfügen -> Run).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

create type project_role as enum ('editor', 'reviewer', 'viewer');
create type project_status as enum ('entwurf', 'in_review', 'live');
create type comment_status as enum ('offen', 'erledigt');

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  is_admin boolean not null default false,
  status text not null default 'eingeladen' check (status in ('eingeladen', 'aktiv')),
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brand text not null,
  status project_status not null default 'entwurf',
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_members (
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role project_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  template_html text not null,
  detected_elements jsonb not null default '[]'::jsonb,
  content_state jsonb not null default '{}'::jsonb,
  original_filename text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table snapshots (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages (id) on delete cascade,
  label text not null,
  content_state jsonb not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages (id) on delete cascade,
  parent_id uuid references comments (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  body text not null,
  x_pct numeric not null,
  y_pct numeric not null,
  status comment_status not null default 'offen',
  created_at timestamptz not null default now()
);

create index projects_brand_idx on projects (brand);
create index projects_created_at_idx on projects (created_at);
create index project_members_user_id_idx on project_members (user_id);
create index pages_project_id_idx on pages (project_id);
create index snapshots_page_id_idx on snapshots (page_id);
create index comments_page_id_idx on comments (page_id);

-- ---------------------------------------------------------------------
-- updated_at automatisch aktualisieren
-- ---------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

create trigger set_pages_updated_at
  before update on pages
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- profiles automatisch aus auth.users befüllen
-- ---------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, status)
  values (new.id, new.email, 'eingeladen')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function handle_user_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    email = new.email,
    status = case
      when new.email_confirmed_at is not null then 'aktiv'
      else status
    end
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function handle_user_update();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table pages enable row level security;
alter table snapshots enable row level security;
alter table comments enable row level security;

-- Hilfsfunktion: ist die eingeloggte Person Admin ODER Mitglied des
-- Projekts mit mindestens der angegebenen Rolle? (editor > reviewer > viewer)
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
      select 1 from project_members
      where project_id = p_project_id
        and user_id = auth.uid()
        and (
          p_min_role is null
          or (p_min_role = 'viewer' and role in ('viewer', 'reviewer', 'editor'))
          or (p_min_role = 'reviewer' and role in ('reviewer', 'editor'))
          or (p_min_role = 'editor' and role = 'editor')
        )
    );
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin);
$$;

-- profiles: alle eingeloggten Personen dürfen die Liste sehen (E-Mails für
-- Rechteverwaltung & Kommentar-Autor:innen); Schreiben nur für Admin oder
-- über die serverseitigen Trigger oben.
create policy "profiles_select_authenticated"
  on profiles for select
  using (auth.uid() is not null);

create policy "profiles_update_admin"
  on profiles for update
  using (is_admin())
  with check (true);

-- projects: sehen darf jedes Mitglied (oder Admin); anlegen/ändern/löschen
-- ist Admin-only.
create policy "projects_select_member"
  on projects for select
  using (is_project_member(id));

create policy "projects_insert_admin"
  on projects for insert
  with check (is_admin());

create policy "projects_update_admin"
  on projects for update
  using (is_admin());

create policy "projects_delete_admin"
  on projects for delete
  using (is_admin());

-- project_members: sehen darf jedes Mitglied des Projekts; verwalten nur Admin.
create policy "project_members_select_member"
  on project_members for select
  using (is_project_member(project_id));

create policy "project_members_insert_admin"
  on project_members for insert
  with check (is_admin());

create policy "project_members_update_admin"
  on project_members for update
  using (is_admin());

create policy "project_members_delete_admin"
  on project_members for delete
  using (is_admin());

-- pages: sehen darf jedes Mitglied; bearbeiten (Inhalt speichern) mind. Editor;
-- löschen (z. B. Projekt umbauen) bleibt Admin vorbehalten.
create policy "pages_select_member"
  on pages for select
  using (is_project_member(project_id));

create policy "pages_insert_editor"
  on pages for insert
  with check (is_project_member(project_id, 'editor'));

create policy "pages_update_editor"
  on pages for update
  using (is_project_member(project_id, 'editor'));

create policy "pages_delete_admin"
  on pages for delete
  using (is_admin());

-- snapshots: nur für Editor/Admin sichtbar und erstellbar (Reviewer/Viewer
-- haben in der App keine Snapshot-Funktion, das erzwingt die Policy zusätzlich).
create policy "snapshots_select_editor"
  on snapshots for select
  using (
    exists (
      select 1 from pages p
      where p.id = snapshots.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );

create policy "snapshots_insert_editor"
  on snapshots for insert
  with check (
    exists (
      select 1 from pages p
      where p.id = snapshots.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );

-- comments: sehen darf jedes Mitglied; schreiben mind. Reviewer; ändern/löschen
-- eigene Kommentare oder (z. B. zum Erledigt-Setzen) Editor/Admin.
create policy "comments_select_member"
  on comments for select
  using (
    exists (
      select 1 from pages p
      where p.id = comments.page_id
        and is_project_member(p.project_id)
    )
  );

create policy "comments_insert_reviewer"
  on comments for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from pages p
      where p.id = comments.page_id
        and is_project_member(p.project_id, 'reviewer')
    )
  );

create policy "comments_update_own_or_editor"
  on comments for update
  using (
    author_id = auth.uid()
    or exists (
      select 1 from pages p
      where p.id = comments.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );

create policy "comments_delete_own_or_editor"
  on comments for delete
  using (
    author_id = auth.uid()
    or exists (
      select 1 from pages p
      where p.id = comments.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );
