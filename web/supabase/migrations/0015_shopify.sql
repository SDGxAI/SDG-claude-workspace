-- SDG Sites: Shopify-Anbindung (Vorschau-Themes kommentieren + per KI ändern)
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0014).
--
-- Ein Projekt kann jetzt statt aus einer HTML-Datei aus einem (nicht
-- veröffentlichten) Shopify-Theme stammen. Die Vorschau wird aus dem Shop
-- geholt; KI-Änderungen landen direkt in den Theme-Dateien. Damit Versionen
-- wiederherstellbar bleiben, merkt sich Sites den Inhalt aller Theme-Dateien,
-- die es angefasst hat.

-- ---------------------------------------------------------------------
-- Shop-Verbindungen (nur Admins, Zugangsdaten nie an den Browser)
-- ---------------------------------------------------------------------
create table if not exists shopify_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shop_domain text not null,
  -- Variante A: App aus dem Dev Dashboard (Client-ID + Secret → Token je 24 h)
  client_id text,
  client_secret text,
  -- Variante B: ältere, direkt im Shopify-Admin angelegte App (shpat_…)
  access_token text,
  -- Passwort der Onlineshop-Seite (solange der Shop nicht live ist)
  storefront_password text,
  -- Zwischengespeichertes Token aus Variante A
  cached_token text,
  cached_token_expires_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- RLS an, aber KEINE Policies: Zugriff ausschließlich serverseitig über den
-- Admin-Client (service_role). So gelangen Secrets nie in den Browser.
alter table shopify_connections enable row level security;

-- ---------------------------------------------------------------------
-- Projekte aus Shopify
-- ---------------------------------------------------------------------
alter table projects add column if not exists source text not null default 'file';
alter table projects drop constraint if exists projects_source_check;
alter table projects
  add constraint projects_source_check check (source in ('file', 'shopify'));

alter table projects
  add column if not exists shopify_connection_id uuid
    references shopify_connections (id) on delete set null;
alter table projects add column if not exists shopify_theme_id text;
alter table projects add column if not exists shopify_theme_name text;
alter table projects add column if not exists shopify_path text;
alter table projects add column if not exists shopify_template text;
-- Originalinhalt jeder Theme-Datei, bevor Sites sie zum ersten Mal geändert hat.
alter table projects
  add column if not exists shopify_baseline jsonb not null default '{}'::jsonb;

-- Inhalt der von Sites geänderten Theme-Dateien im jeweiligen Stand.
alter table pages
  add column if not exists shopify_files jsonb not null default '{}'::jsonb;
alter table page_versions add column if not exists shopify_files jsonb;
alter table page_drafts add column if not exists shopify_files jsonb;

-- Quelle „shopify" für Versionen (neu aus dem Shop geladen) zulassen.
alter table page_versions drop constraint if exists page_versions_source_check;
alter table page_versions
  add constraint page_versions_source_check
  check (source in ('manual', 'editor', 'claude', 'umsetzen', 'import', 'ki', 'shopify'));
