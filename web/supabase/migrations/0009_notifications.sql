-- SDG Landingpage-Editor: Mitteilungen (Benachrichtigungen)
-- Führe diese Datei einmalig im Supabase SQL Editor aus (nach 0008).
--
-- Beispiel: Wird ein Kommentar als erledigt markiert, bekommt die Person,
-- die den Kommentar geschrieben hat, eine Mitteilung.

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

-- Jede:r sieht/ändert/löscht nur die EIGENEN Mitteilungen. Das Anlegen
-- erfolgt ausschließlich serverseitig (service_role) – daher keine
-- Insert-Policy für normale Clients.
create policy "notifications_select_own"
  on notifications for select
  using (user_id = auth.uid());

create policy "notifications_update_own"
  on notifications for update
  using (user_id = auth.uid());

create policy "notifications_delete_own"
  on notifications for delete
  using (user_id = auth.uid());
