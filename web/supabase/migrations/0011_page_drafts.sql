-- SDG Landingpage-Editor: KI-Bearbeiten (Meta-Ebene / Entwurf)
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0010).
--
-- Ein Entwurf ist eine Arbeitskopie einer Seite plus Chatverlauf. Man kann
-- darin per KI beliebig oft iterieren, ohne dass jedes Mal eine neue Version
-- entsteht. Erst beim „Als neue Version speichern" wird der Entwurf zur neuen
-- aktuellen Version.

create table if not exists page_drafts (
  page_id uuid primary key references pages (id) on delete cascade,
  html text not null,
  messages jsonb not null default '[]'::jsonb,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table page_drafts enable row level security;

-- Sehen/Anlegen/Ändern/Löschen nur für Editor:innen/Admins des Projekts.
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

-- Quelle „ki" für Versionen aus der KI-Bearbeiten-Ebene zulassen.
alter table page_versions drop constraint if exists page_versions_source_check;
alter table page_versions
  add constraint page_versions_source_check
  check (source in ('manual', 'editor', 'claude', 'umsetzen', 'import', 'ki'));
