-- SDG Sites: Speicher-Übersicht für Admins und Größe je Version
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0018).

-- Größe jeder Version in Bytes (rechnet die Datenbank automatisch aus).
alter table page_versions add column if not exists size_bytes integer
  generated always as (
    octet_length(template_html)
    + coalesce(octet_length(detected_elements::text), 0)
    + coalesce(octet_length(content_state::text), 0)
    + coalesce(octet_length(comments_snapshot::text), 0)
    + coalesce(octet_length(shopify_files::text), 0)
  ) stored;

-- Speicher-Übersicht (nur Admins): Datenbankgröße, Dateien je Speicher und
-- Verbrauch je Projekt.
create or replace function storage_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  result jsonb;
begin
  if not is_admin() then
    raise exception 'Nur für Admins';
  end if;

  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket_id, 'bytes', b.bytes, 'files', b.files) order by b.bytes desc), '[]'::jsonb)
      from (
        select bucket_id, coalesce(sum((metadata->>'size')::bigint), 0) as bytes, count(*) as files
        from storage.objects
        group by bucket_id
      ) b
    ),
    'projects', (
      select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb)
      from (
        select
          pr.id,
          pr.title,
          pr.brand,
          (select coalesce(sum(octet_length(pg.template_html)), 0) from pages pg where pg.project_id = pr.id) as page_bytes,
          (select count(*) from page_versions v join pages pg on pg.id = v.page_id where pg.project_id = pr.id) as versions,
          (select coalesce(sum(v.size_bytes), 0) from page_versions v join pages pg on pg.id = v.page_id where pg.project_id = pr.id) as versions_bytes,
          (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o
            where o.bucket_id in ('ki-assets', 'project-images') and o.name like pr.id::text || '/%') as image_bytes
        from projects pr
      ) p
    )
  ) into result;

  return result;
end;
$$;

revoke all on function storage_overview() from public;
grant execute on function storage_overview() to authenticated;
