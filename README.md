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
- `supabase/schema.sql`: run once in Supabase SQL Editor.
- `tests.html`: open in a browser to check the calculation.

## Run locally
Modules need a local web server, not file://:

    cd app
    python3 -m http.server 8000

Then open http://localhost:8000 and http://localhost:8000/tests.html.

resources/* has sample data that can be imported for testing.

## Baseline
Tour values from Broadie's published table, plus an estimated per-lie offset
so a typical scratch round totals about 0. Check the tour rows against the
published source. To change the offset, edit `scratch_offset`, bump the `id`,
and update the file name in `js/app.js`. Strokes gained is never stored, so
past rounds recalculate.

## Offline and install
`sw.js` caches the app so it opens with no signal; `manifest.webmanifest` and
`icons/` make it installable. **Bump `VERSION` in sw.js on every deploy**, or
phones keep the old files. After an update downloads, the home screen shows
"Update ready · Tap to reload" (it never reloads mid-hole on its own).

Install: iPhone Safari → Share → Add to Home Screen. Android Chrome → menu →
Install app. Installing also stops iOS from clearing stored rounds.

## Next step
5. Deploy: GitHub repo → Cloudflare Pages. Create a Supabase project, run
   `supabase/schema.sql`, enable email sign-in, add your Pages URL under
   Auth → URL Configuration, and fill in `config.js`.
