-- SDG Sites: Briefings der Marken
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0017).
--
-- Marken reichen hier kurz ein, was sie für eine Landingpage brauchen:
-- Produktinfos, (optional) eigenen Text, Fotos/Videos, Inspirations-Links.
-- Fotos und Videos liegen im privaten Speicher „briefings“ (nur über
-- zeitlich begrenzte Links abrufbar).

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  title text not null,
  go_live date,
  product_info text not null,
  important text,
  own_text text,
  wants_ai_text boolean not null default true,
  files jsonb not null default '[]'::jsonb,
  kids_transfer_link text,
  inspiration_urls text[] not null default '{}',
  inspiration_note text,
  status text not null default 'neu' check (status in ('neu', 'in_arbeit', 'erledigt')),
  ai_text jsonb,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Für alle, die diese Datei schon vor dem Feld „Was ist dir wichtig?“ ausgeführt haben.
alter table briefings add column if not exists important text;

create index if not exists briefings_created_idx on briefings (created_at desc);

alter table briefings enable row level security;

-- Eigene Briefings sehen; Admins sehen alle.
drop policy if exists "briefings_select" on briefings;
create policy "briefings_select" on briefings for select
  using (created_by = auth.uid() or is_admin());

-- Jede:r Angemeldete darf ein Briefing einreichen (nur im eigenen Namen).
drop policy if exists "briefings_insert" on briefings;
create policy "briefings_insert" on briefings for insert
  with check (created_by = auth.uid());

-- Status und KI-Text pflegen nur Admins.
drop policy if exists "briefings_update" on briefings;
create policy "briefings_update" on briefings for update
  using (is_admin()) with check (is_admin());

-- Löschen: Admins immer, Einreichende solange noch nicht bearbeitet.
drop policy if exists "briefings_delete" on briefings;
create policy "briefings_delete" on briefings for delete
  using (is_admin() or (created_by = auth.uid() and status = 'neu'));

-- Privater Speicher für Fotos und Videos. Hochladen und Abrufen laufen über
-- zeitlich begrenzte Links, die nur der Server ausstellt.
insert into storage.buckets (id, name, public)
values ('briefings', 'briefings', false)
on conflict (id) do nothing;
