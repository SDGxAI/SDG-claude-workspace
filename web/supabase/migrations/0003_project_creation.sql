-- Projekte dürfen jetzt von allen angemeldeten Nutzer:innen angelegt werden
-- (nicht mehr nur Admins). Wer ein Projekt anlegt, wird automatisch Editor
-- dieses Projekts. Einmalig im Supabase SQL Editor ausführen.

-- Alte Admin-only-Insert-Policy ersetzen
drop policy if exists "projects_insert_admin" on projects;

create policy "projects_insert_authenticated"
  on projects for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Ersteller:in automatisch als Editor des neuen Projekts eintragen
create or replace function handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into project_members (project_id, user_id, role)
    values (new.id, new.created_by, 'editor')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_project_created on projects;
create trigger on_project_created
  after insert on projects
  for each row execute function handle_new_project();
