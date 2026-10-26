// Tiny IndexedDB key/value wrapper used to cache show + episode data.
const DB_NAME = 'tvtrack';
const STORE = 'kv';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  }));
}

export const idbGet = key => tx('readonly', s => s.get(key)).catch(() => undefined);
export const idbSet = (key, value) => tx('readwrite', s => s.put(value, key)).catch(() => {});
export const idbDel = key => tx('readwrite', s => s.delete(key)).catch(() => {});
export const idbKeys = () => tx('readonly', s => s.getAllKeys()).catch(() => []);
