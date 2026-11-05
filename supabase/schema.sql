-- Run once in Supabase → SQL Editor.
-- Each table stores the record body in `data`; the columns outside it are what sync and security need.

create or replace function touch_synced_at() returns trigger language plpgsql as $$
begin new.synced_at = clock_timestamp(); return new; end $$;

create table if not exists courses (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

create table if not exists rounds (like courses including all);

create table if not exists hole_entries (like courses including all);
alter table hole_entries add column if not exists round_id text not null;

do $$ declare t text; begin
  foreach t in array array['courses','rounds','hole_entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists own_rows on %I', t);
    execute format('create policy own_rows on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop trigger if exists touch on %I', t);
    execute format('create trigger touch before insert or update on %I for each row execute function touch_synced_at()', t);
    execute format('create index if not exists %I on %I (user_id, synced_at)', t || '_sync_idx', t);
  end loop;
end $$;

create index if not exists hole_entries_round_idx on hole_entries (round_id);
