// IndexedDB wrapper. Stores: courses, rounds, holes (index round_id), meta (key/value).
// put() is a local edit: stamps updated_at, marks dirty, notifies listeners (triggers sync).
// putRaw() writes as-is (used by sync and import).
const NAME = 'strokes-gained', VERSION = 1;
let dbp; const listeners = [];

function open() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('courses', { keyPath: 'id' });
      d.createObjectStore('rounds', { keyPath: 'id' });
      d.createObjectStore('holes', { keyPath: 'id' }).createIndex('round_id', 'round_id');
      d.createObjectStore('meta');
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
