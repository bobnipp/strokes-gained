// Local-first sync with Supabase. Pull (server newer wins), then push dirty records.
// Pulls are incremental on the server-set synced_at column, so clock differences between devices don't drop rows.
// Courses are shared by every signed-in user (see supabase/shared-courses.sql); rounds, holes and prefs are private.
// Sign-in is invite-only: the sign-in link never creates a new account.
import { CONFIG } from '../config.js';
import * as db from './db.js';

const TABLES = [['courses', 'courses'], ['rounds', 'rounds'], ['holes', 'hole_entries'], ['prefs', 'prefs']];
// Bump a table's cursor version to re-pull it from the start once (courses: pick up everyone's shared courses).
const CURSOR = { courses: 'pull:courses:shared-v1' };
const PAGE = 1000;
let sb;

export const enabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
async function client() {
  if (!sb) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const url = CONFIG.supabaseUrl.trim().replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');
    sb = createClient(url, CONFIG.supabaseAnonKey.trim(), { auth: { persistSession: true, detectSessionInUrl: true } });
  }
  return sb;
}
export async function session() {
  if (!enabled()) return null;
  try { return (await (await client()).auth.getSession()).data.session; } catch { return null; }
}
export async function signIn(email) {
  const { error } = await (await client()).auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
  if (error) {
    if (/sign ?ups? not allowed|user not found|not allowed for otp/i.test(error.message || '')) throw new Error("That email hasn't been invited. Ask whoever runs the app to invite you.");
    throw error;
  }
}
export async function signOut() { await (await client()).auth.signOut(); }

const newer = (a, b) => Date.parse(a) > Date.parse(b);

// Server row → local record. Courses keep who added (owner) and last edited (editor) them.
export function fromRow(store, row) {
  return { ...row.data, id: row.id, updated_at: new Date(row.updated_at).toISOString(), deleted_at: row.deleted_at, dirty: 0,
    ...(store === 'courses' ? { owner: row.user_id ?? null, editor: row.updated_by ?? null } : {}) };
}
// Local record → server row. Shared courses never send user_id: the database sets it to you on insert and keeps the creator on update.
export function toRow(store, rec, uid) {
  const { dirty, id, updated_at, deleted_at, owner, editor, ...data } = rec;
  const row = { id, updated_at, deleted_at: deleted_at || null, data };
  if (store !== 'courses') row.user_id = uid;
  if (store === 'holes') row.round_id = data.round_id;
  return row;
}

export async function sync() {
  if (!enabled()) return { status: 'off' };
  if (!navigator.onLine) return { status: 'offline' };
  const s = await session();
  if (!s) return { status: 'signed-out' };
  const c = await client(), uid = s.user.id;
  let changed = false;

  for (const [store, table] of TABLES) {
    const key = CURSOR[store] || 'pull:' + table, cols = 'id,data,updated_at,deleted_at,synced_at' + (store === 'courses' ? ',user_id,updated_by' : '');
    const since = (await db.getMeta(key)) || '1970-01-01T00:00:00+00:00';
    let max = since;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from(table).select(cols).gt('synced_at', since).order('synced_at').range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data) {
        const local = await db.get(store, row.id), rec = fromRow(store, row);
        if (!local || newer(rec.updated_at, local.updated_at)) { await db.putRaw(store, rec); changed = true; }
        else if (store === 'courses' && local && !local.dirty && (local.owner !== rec.owner || local.editor !== rec.editor)) {
          await db.putRaw(store, { ...local, owner: rec.owner, editor: rec.editor }); changed = true;
        }
        max = row.synced_at;
      }
      if (data.length < PAGE) break;
    }
    await db.setMeta(key, max);

    const dirty = (await db.all(store)).filter(r => r.dirty);
    if (!dirty.length) continue;
    const rows = dirty.map(r => toRow(store, r, uid));
    for (let k = 0; k < rows.length; k += 500) {
      const { error } = await c.from(table).upsert(rows.slice(k, k + 500));
      if (error) throw error;
    }
    for (const r of dirty) {
      const cur = await db.get(store, r.id);
      if (cur && cur.updated_at === r.updated_at) await db.putRaw(store, { ...cur, dirty: 0, ...(store === 'courses' && !cur.owner ? { owner: uid } : {}) });
    }
  }
  return { status: 'ok', email: s.user.email, uid, changed };
}