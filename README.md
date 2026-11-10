# Strokes Gained

Personal strokes-gained tracker. Static web app: no build step, no server code.

## Files
- `index.html`, `app.css`, `ds.css`: page and styles (ds.css is the Modernist design system).
- `js/app.js`: screens and actions.
- `js/sg.js`: strokes-gained calculation (pure functions).
- `js/db.js`: on-phone storage (IndexedDB).
- `js/sync.js`: Supabase sync (pull newer, then push changes).
- `config.js`: Supabase URL and anon key. Blank = phone-only.
- `baseline/broadie-2011-scratch-v1.json`: expected-strokes table + scratch offset.
- `baseline/handicap-levels-v1.json`: estimated 5/10/15-handicap adjustments.
- `supabase/schema.sql`: run once in Supabase SQL Editor.
- `supabase/shared-courses.sql`: run once after schema.sql to share courses (see below).
- `tests.html`: open in a browser to check the calculation.

## Run locally
Modules need a local web server, not file://:

    cd app
    python3 -m http.server 8000

Then open http://localhost:8000 and http://localhost:8000/tests.html.

## Baseline
Tour values from Broadie's published table, plus an estimated per-lie offset
so a typical scratch round totals about 0. Check the tour rows against the
published source. To change the offset, edit `scratch_offset`, bump the `id`,
and update the file name in `js/app.js`. Strokes gained is never stored, so
past rounds recalculate.

Settings → Strokes gained → Compare against picks Scratch or a typical
5/10/15-handicap round (stored per device). Those levels are estimates in
`baseline/handicap-levels-v1.json`: a fixed amount added per tee shot,
approach, missed green and putting hole. The file explains how the numbers
were derived; edit it to retune, and bump `VERSION` in sw.js.

## Offline and install
`sw.js` caches the app so it opens with no signal; `manifest.webmanifest` and
`icons/` make it installable. **Bump `VERSION` in sw.js on every deploy**, or
phones keep the old files. After an update downloads, the home screen shows
"Update ready · Tap to reload" (it never reloads mid-hole on its own).

Install: iPhone Safari → Share → Add to Home Screen. Android Chrome → menu →
Install app. Installing also stops iOS from clearing stored rounds.

## Shared courses (invite-only)
Courses are shared by everyone signed in: anyone can add or fix a course; only
the person who added it can delete it (others get "Hide from my list"). Rounds,
hole scores and personal settings (home course, hidden courses) stay private.
Every course edit saves the previous version in `course_history`.

One-time setup in Supabase:
1. **SQL Editor:** run `supabase/shared-courses.sql` (after `schema.sql`). Safe to re-run.
2. **Turn off public sign-ups:** Authentication → Sign In / Providers →
   "Allow new users to sign up" off. (The app also never creates accounts from
   the sign-in link, so an uninvited email just gets "hasn't been invited".)
3. **Check redirect URLs:** Authentication → URL Configuration → Site URL is your
   Pages URL, so invite and sign-in links open the app.

Inviting someone: Authentication → Users → Add user → Send invitation, enter
their email. They open the invite link on their phone (or open the app, tap
the sync dot and request a sign-in link with that email). After their first
sync they see every shared course.

Note: courses you added before this change become visible to people you
invite. Deleted ones stay hidden in the app.

Undo a bad course edit (SQL Editor). Find the course id in the app's backup
export, or with `select id, data->>'name' from courses;`:

    -- versions of one course, newest first
    select id, replaced_at, data->>'name' as name, deleted_at from course_history
      where course_id = 'COURSE-ID' order by replaced_at desc;
    -- put back version HISTORY-ID
    update courses set data = h.data, deleted_at = h.deleted_at, updated_at = now()
      from course_history h where h.id = HISTORY-ID and courses.id = h.course_id;

Phones pick up the restored version on their next sync.

## Next step
5. Deploy: GitHub repo → Cloudflare Pages. Create a Supabase project, run
   `supabase/schema.sql`, enable email sign-in, add your Pages URL under
   Auth → URL Configuration, and fill in `config.js`.