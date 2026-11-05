// Local-first sync with Supabase. Pull (server newer wins), then push dirty records.
// Pulls are incremental on the server-set synced_at column, so clock differences between devices don't drop rows.
import { CONFIG } from '../config.js';
import * as db from './db.js';

const TABLES = [['courses', 'courses'], ['rounds', 'rounds'], ['holes', 'hole_entries']];
const PAGE = 1000;
let sb;

export const enabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
async function client() {
  if (!sb) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  }
  return sb;
}
export async function session() {
  if (!enabled()) return null;
  try { return (await (await client()).auth.getSession()).data.session; } catch { return null; }
}
export async function signIn(email) {
  const { error } = await (await client()).auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function signOut() { await (await client()).auth.signOut(); }

const newer = (a, b) => Date.parse(a) > Date.parse(b);

export async function sync() {
  if (!enabled()) return { status: 'off' };
  if (!navigator.onLine) return { status: 'offline' };
  const s = await session();
  if (!s) return { status: 'signed-out' };
  const c = await client(), uid = s.user.id;
  let changed = false;

  for (const [store, table] of TABLES) {
    const key = 'pull:' + table;
    const since = (await db.getMeta(key)) || '1970-01-01T00:00:00+00:00';
    let max = since;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from(table).select('id,data,updated_at,deleted_at,synced_at')
        .gt('synced_at', since).order('synced_at').range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data) {
        const local = await db.get(store, row.id), updated_at = new Date(row.updated_at).toISOString();
        if (!local || newer(updated_at, local.updated_at)) {
          await db.putRaw(store, { ...row.data, id: row.id, updated_at, deleted_at: row.deleted_at, dirty: 0 });
          changed = true;
        }
        max = row.synced_at;
      }
      if (data.length < PAGE) break;
    }
    await db.setMeta(key, max);

    const dirty = (await db.all(store)).filter(r => r.dirty);
    if (!dirty.length) continue;
    const rows = dirty.map(({ dirty, id, updated_at, deleted_at, ...data }) =>
      ({ id, user_id: uid, updated_at, deleted_at: deleted_at || null, data, ...(store === 'holes' ? { round_id: data.round_id } : {}) }));
    for (let k = 0; k < rows.length; k += 500) {
      const { error } = await c.from(table).upsert(rows.slice(k, k + 500));
      if (error) throw error;
    }
    for (const r of dirty) {
      const cur = await db.get(store, r.id);
      if (cur && cur.updated_at === r.updated_at) await db.putRaw(store, { ...cur, dirty: 0 });
    }
  }
  return { status: 'ok', email: s.user.email, changed };
}
