-- SDG Landingpage-Editor: Storage für Bild-Uploads
-- Einmalig im Supabase SQL Editor ausführen (nach 0001_init.sql).

-- Privater Bucket für Projektbilder (nur über signierte URLs erreichbar).
insert into storage.buckets (id, name, public)
values ('project-images', 'project-images', false)
on conflict (id) do nothing;

-- Zugriff wird über denselben is_project_member-Check wie die übrigen
-- Tabellen geregelt: der erste Ordner im Objektpfad ist die project_id.

create policy "project_images_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-images'
    and is_project_member(((storage.foldername(name))[1])::uuid)
  );

create policy "project_images_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-images'
    and is_project_member(((storage.foldername(name))[1])::uuid, 'editor')
  );

create policy "project_images_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'project-images'
    and is_project_member(((storage.foldername(name))[1])::uuid, 'editor')
  );

create policy "project_images_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-images'
    and is_project_member(((storage.foldername(name))[1])::uuid, 'editor')
  );
