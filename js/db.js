// IndexedDB wrapper. Stores: courses, rounds, holes (index round_id), prefs (per-user settings that sync), meta (key/value, this device only).
// put() is a local edit: stamps updated_at, marks dirty, notifies listeners (triggers sync).
// putRaw() writes as-is (used by sync and import).
const NAME = 'strokes-gained', VERSION = 2;
let dbp; const listeners = [];

function open() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result, has = n => d.objectStoreNames.contains(n);
      if (!has('courses')) d.createObjectStore('courses', { keyPath: 'id' });
      if (!has('rounds')) d.createObjectStore('rounds', { keyPath: 'id' });
      if (!has('holes')) d.createObjectStore('holes', { keyPath: 'id' }).createIndex('round_id', 'round_id');
      if (!has('meta')) d.createObjectStore('meta');
      if (!has('prefs')) d.createObjectStore('prefs', { keyPath: 'id' }); // v2
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const os = async (name, mode = 'readonly') => (await open()).transaction(name, mode).objectStore(name);

export const all = async s => req((await os(s)).getAll());
export const get = async (s, id) => req((await os(s)).get(id));
export const holesFor = async rid => req((await os('holes')).index('round_id').getAll(rid));
export async function putRaw(s, rec) { await req((await os(s, 'readwrite')).put(rec)); return rec; }
export async function put(s, rec) {
  rec = { ...rec, updated_at: new Date().toISOString(), dirty: 1 };
  await putRaw(s, rec);
  listeners.forEach(f => f(s, rec));
  return rec;
}
export const getMeta = async k => req((await os('meta')).get(k));
export const setMeta = async (k, v) => req((await os('meta', 'readwrite')).put(v, k));
export const onChange = f => listeners.push(f);
export const uuid = () => crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });