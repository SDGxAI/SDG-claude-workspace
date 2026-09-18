-- =====================================================================
-- SDG Landingpage-Editor – neue Funktionen aktivieren
-- Versionsverlauf (0007) + Claude-Schnittstelle (0008) + Mitteilungen (0009)
--
-- SO WIRD ES AUSGEFÜHRT:
--   1. Im Supabase-Dashboard links auf „SQL Editor" klicken.
--   2. „New query" öffnen.
--   3. Den KOMPLETTEN Inhalt dieser Datei hineinkopieren.
--   4. Auf „Run" klicken.
-- Das Skript ist so gebaut, dass es gefahrlos auch mehrfach laufen darf.
-- =====================================================================

-- ---------- 0007: Versionsverlauf -----------------------------------
create table if not exists page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages (id) on delete cascade,
  version_no int not null,
  label text,
  source text not null default 'editor'
    check (source in ('manual', 'editor', 'claude', 'umsetzen', 'import')),
  template_html text not null,
  detected_elements jsonb not null default '[]'::jsonb,
  content_state jsonb not null default '{}'::jsonb,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists page_versions_page_id_idx on page_versions (page_id);
create unique index if not exists page_versions_page_no_idx
  on page_versions (page_id, version_no);

create or replace function next_page_version_no(p_page_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  select coalesce(max(version_no), 0) + 1
  from page_versions
  where page_id = p_page_id;
$$;

alter table page_versions enable row level security;

drop policy if exists "page_versions_select_member" on page_versions;
create policy "page_versions_select_member"
  on page_versions for select
  using (
    exists (
      select 1 from pages p
      where p.id = page_versions.page_id
        and is_project_member(p.project_id)
    )
  );

drop policy if exists "page_versions_insert_editor" on page_versions;
create policy "page_versions_insert_editor"
  on page_versions for insert
  with check (
    exists (
      select 1 from pages p
      where p.id = page_versions.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );

drop policy if exists "page_versions_delete_editor" on page_versions;
create policy "page_versions_delete_editor"
  on page_versions for delete
  using (
    exists (
      select 1 from pages p
      where p.id = page_versions.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );

-- ---------- 0008: Update-Schlüssel (Claude-Schnittstelle) -----------
alter table projects add column if not exists ingest_token text;

create unique index if not exists projects_ingest_token_idx
  on projects (ingest_token)
  where ingest_token is not null;

-- ---------- 0009: Mitteilungen --------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  body text not null,
  project_id uuid references projects (id) on delete cascade,
  comment_id uuid references comments (id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on notifications (user_id, read, created_at desc);

alter table notifications enable row level security;

drop policy if exists "notifications_select_own" on notifications;
create policy "notifications_select_own"
  on notifications for select
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on notifications;
create policy "notifications_update_own"
  on notifications for update
  using (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on notifications;
create policy "notifications_delete_own"
  on notifications for delete
  using (user_id = auth.uid());
