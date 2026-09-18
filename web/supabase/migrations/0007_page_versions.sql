-- SDG Landingpage-Editor: Versionsverlauf
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0001-0006).
--
-- Idee: Die Zeile in `pages` ist immer die AKTUELLE Version (hier wird
-- bearbeitet und kommentiert). Frühere Stände werden als vollständige
-- Momentaufnahmen (Vorlage + Inhalt) in `page_versions` archiviert, damit
-- man sie ansehen, vergleichen und bei Bedarf wiederherstellen kann.

create table if not exists page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages (id) on delete cascade,
  version_no int not null,
  label text,
  -- Woher stammt die Version: manuell gespeichert, aus dem Editor, per
  -- Claude-Schnittstelle importiert oder von der KI umgesetzt.
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

-- ---------------------------------------------------------------------
-- Nächste Versionsnummer einer Seite (1, 2, 3 …), atomar.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table page_versions enable row level security;

-- Sehen/Vergleichen darf jedes Projektmitglied.
create policy "page_versions_select_member"
  on page_versions for select
  using (
    exists (
      select 1 from pages p
      where p.id = page_versions.page_id
        and is_project_member(p.project_id)
    )
  );

-- Anlegen (Version speichern) mind. Editor.
create policy "page_versions_insert_editor"
  on page_versions for insert
  with check (
    exists (
      select 1 from pages p
      where p.id = page_versions.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );

-- Löschen (Version entfernen) mind. Editor.
create policy "page_versions_delete_editor"
  on page_versions for delete
  using (
    exists (
      select 1 from pages p
      where p.id = page_versions.page_id
        and is_project_member(p.project_id, 'editor')
    )
  );
