/* Alembic · gallery
 * Keeps your images and videos in this browser (IndexedDB), so "My creations" survive a reload.
 * Storage is optional: private windows and some embedded previews block it, and then the
 * studios keep this session's creations only. Every call here fails soft.
 */
(function () {
  'use strict';
  const A = window.Alembic;
  const DB_NAME = 'alembic';
  const STORE = 'creations';
  // Saved with each creation; the object URL and anything else is rebuilt on load.
  const FIELDS = ['id', 'kind', 'blob', 'mime', 'ext', 'prompt', 'ratio', 'style', 'seconds', 'engineId', 'engineLabel', 'extras', 'createdAt'];

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try {
          if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB is not available');
          req = indexedDB.open(DB_NAME, 1);
        } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('kind', 'kind');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB failed to open'));
        req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
      });
      dbPromise.catch(() => {});
    }
    return dbPromise;
  }

  /** Run one request in a transaction and resolve with its result once the transaction commits. */
  async function run(mode, make) {
    const d = await db();
    return new Promise((resolve, reject) => {
      let t;
      try { t = d.transaction(STORE, mode); } catch (e) { reject(e); return; }
      const req = make(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error || (req && req.error) || new Error('IndexedDB request failed'));
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function record(item) {
    const r = {};
    for (const k of FIELDS) if (item[k] !== undefined) r[k] = item[k];
    return r;
  }

  let ok = null;
  A.gallery = {
    /** True when this browser lets Alembic keep creations between visits. */
    async available() {
      if (ok === null) {
        try { await db(); ok = true; } catch (_) { ok = false; }
      }
      return ok;
    },
    /** Saved creations of one kind ('image' | 'video'), newest first. */
    async list(kind) {
      const all = await run('readonly', (s) => s.index('kind').getAll(kind));
      return (all || []).filter((r) => r && r.blob instanceof Blob).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
    /** Save (or replace) one creation. Rejects with QuotaExceededError when the browser is full. */
    put(item) {
      return run('readwrite', (s) => s.put(record(item)));
    },
    remove(id) {
      return run('readwrite', (s) => s.delete(id));
    },
    /** Delete every saved creation of one kind. */
    async clear(kind) {
      const keys = await run('readonly', (s) => s.index('kind').getAllKeys(kind));
      if (keys && keys.length) await run('readwrite', (s) => { let last = null; for (const k of keys) last = s.delete(k); return last; });
    },
  };
})();
