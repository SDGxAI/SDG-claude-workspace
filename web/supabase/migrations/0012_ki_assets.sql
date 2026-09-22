-- SDG Landingpage-Editor: öffentlicher Bilder-Bucket für „Mit KI bearbeiten"
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0011).
--
-- Hochgeladene Bilder bekommen eine dauerhafte, öffentliche URL, die die KI
-- direkt als <img src> in die Seite einbauen kann.

insert into storage.buckets (id, name, public)
values ('ki-assets', 'ki-assets', true)
on conflict (id) do nothing;

-- Angemeldete Nutzer:innen dürfen Bilder hochladen.
drop policy if exists "ki_assets_insert" on storage.objects;
create policy "ki_assets_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ki-assets');

-- Lesen ist öffentlich (Bucket ist public).
drop policy if exists "ki_assets_read" on storage.objects;
create policy "ki_assets_read"
  on storage.objects for select
  using (bucket_id = 'ki-assets');
