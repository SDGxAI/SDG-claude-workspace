-- =====================================================================
-- SDG Landingpage-Editor – Kommentare je Version (0010) + KI-Bearbeiten (0011)
--
-- SO WIRD ES AUSGEFÜHRT:
--   1. Supabase-Dashboard → links „SQL Editor" → „New query".
--   2. Den KOMPLETTEN Inhalt dieser Datei einfügen → „Run".
-- Gefahrlos auch mehrfach ausführbar.
-- =====================================================================

-- ---------- 0010: Kommentare je Version festhalten ------------------
alter table page_versions
  add column if not exists comments_snapshot jsonb not null default '[]'::jsonb;

-- ---------- 0011: KI-Bearbeiten (Entwurf) --------------------------
create table if not exists page_drafts (
  page_id uuid primary key references pages (id) on delete cascade,
  html text not null,
  messages jsonb not null default '[]'::jsonb,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table page_drafts enable row level security;

drop policy if exists "page_drafts_all_editor" on page_drafts;
create policy "page_drafts_all_editor"
  on page_drafts for all
  using (
    exists (
      select 1 from pages p
      where p.id = page_drafts.page_id
        and is_project_member(p.project_id, 'editor')
    )
  )
  with check (
    exists (
      select 1 from pages p
      where p.id = page_drafts.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );

alter table page_versions drop constraint if exists page_versions_source_check;
alter table page_versions
  add constraint page_versions_source_check
  check (source in ('manual', 'editor', 'claude', 'umsetzen', 'import', 'ki'));
