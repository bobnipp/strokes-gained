-- Shared courses. Run once in Supabase → SQL Editor, AFTER schema.sql. Safe to run again.
--
-- What it does:
--   * Every signed-in user can see and edit every course. (Sign-in is invite-only: see README.)
--   * The person who added a course stays its creator (user_id); only they can delete it.
--   * Every edit records who made it (updated_by) and saves the previous version in course_history.
--   * Rounds and hole scores stay private, as before.
--   * A private per-user `prefs` table holds settings such as your home course and hidden courses.

-- ---- courses: shared read and edit -------------------------------------------------
alter table courses add column if not exists updated_by uuid default auth.uid();

drop policy if exists own_rows on courses;
drop policy if exists courses_read on courses;
drop policy if exists courses_insert on courses;
drop policy if exists courses_update on courses;
create policy courses_read   on courses for select to authenticated using (true);
create policy courses_insert on courses for insert to authenticated with check (user_id = auth.uid());
create policy courses_update on courses for update to authenticated using (true) with check (true);
-- No delete policy: the app never hard-deletes. It sets deleted_at, which the trigger below limits to the creator.

-- Keep the creator, stamp the editor, and let only the creator delete or restore.
-- A non-creator's delete is quietly ignored rather than raised, so one bad row can't stall everyone's sync.
create or replace function courses_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    -- auth.uid() is null in the SQL Editor (you, as admin), so you can always delete or restore there.
    if new.deleted_at is distinct from old.deleted_at and auth.uid() is not null and old.user_id is distinct from auth.uid() then
      new.deleted_at := old.deleted_at;
    end if;
  end if;
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists guard on courses;
create trigger guard before insert or update on courses for each row execute function courses_guard();

-- Pulls no longer filter by user, so index synced_at on its own.
create index if not exists courses_synced_idx on courses (synced_at);

-- ---- course_history: the previous version of a course, saved on every change ------
create table if not exists course_history (
  id bigserial primary key,
  course_id text not null,
  data jsonb not null,
  deleted_at timestamptz,
  edited_by uuid,                                   -- who made the version being replaced
  replaced_at timestamptz not null default now(),
  replaced_by uuid                                  -- who replaced it
);
create index if not exists course_history_course_idx on course_history (course_id, replaced_at desc);
alter table course_history enable row level security;
drop policy if exists history_read on course_history;
create policy history_read on course_history for select to authenticated using (true);
-- Rows are written only by the trigger below (security definer), never by the app.

create or replace function courses_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.data is distinct from new.data or old.deleted_at is distinct from new.deleted_at then
    insert into course_history (course_id, data, deleted_at, edited_by, replaced_by)
    values (old.id, old.data, old.deleted_at, old.updated_by, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists history on courses;
create trigger history after update on courses for each row execute function courses_history();

-- ---- prefs: private per-user settings, synced like the other tables ---------------
create table if not exists prefs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
alter table prefs enable row level security;
drop policy if exists own_rows on prefs;
create policy own_rows on prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists touch on prefs;
create trigger touch before insert or update on prefs for each row execute function touch_synced_at();
create index if not exists prefs_sync_idx on prefs (user_id, synced_at);