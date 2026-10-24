const stores = ['documents', 'annotations', 'pages', 'files', 'state'];
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// Keep each website path in its own browser database.
export function createLibraryDatabase(factory, name) {
  let connection;
  async function open() {
    if (!factory) throw new Error('This browser cannot save a library. Use a browser with IndexedDB enabled.');
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('documents', { keyPath: 'id' });
        db.createObjectStore('annotations', { keyPath: 'id' });
        db.createObjectStore('pages', { keyPath: ['doc_id', 'number'] });
        db.createObjectStore('files', { keyPath: 'name' });
        db.createObjectStore('state', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
      request.onerror = () => { connection = null; reject(request.error); };
      request.onblocked = () => reject(new Error('Close other Quiet Margin tabs, then reload to update storage.'));
    });
    return connection;
  }
  async function transaction(names, mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value, failure;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('Saving was interrupted. Please retry.'));
      try {
        Promise.resolve(operation(tx)).then(v => { value = v; }).catch(error => {
          failure = error;
          try { tx.abort(); } catch { reject(error); }
        });
      } catch (error) { failure = error; tx.abort(); }
    });
  }
  const get = (store, key) => transaction([store], 'readonly', tx => result(tx.objectStore(store).get(key)));
  const all = store => transaction([store], 'readonly', tx => result(tx.objectStore(store).getAll()));
  const put = (store, value) => transaction([store], 'readwrite', tx => result(tx.objectStore(store).put(value)));
  async function snapshot(includeFiles = false) {
    const selected = includeFiles ? stores : stores.filter(name => name !== 'files');
    return transaction(selected, 'readonly', async tx => {
      const rows = await Promise.all(selected.map(name => result(tx.objectStore(name).getAll())));
      return Object.fromEntries(selected.map((name, i) => [name, rows[i]]));
    });
  }
  async function replace(manifest, files) {
    // All changes commit together, including the files and previous-library recovery copy.
    return transaction(stores, 'readwrite', async tx => {
      const previous = await Promise.all(['documents', 'annotations', 'pages', 'files'].map(name => result(tx.objectStore(name).getAll())));
      const workspace = await result(tx.objectStore('state').get('workspace'));
      for (const name of ['documents', 'annotations', 'pages', 'files']) tx.objectStore(name).clear();
      tx.objectStore('state').put({ key: 'recovery', value: {
        documents: previous[0], annotations: previous[1], pages: previous[2], files: previous[3], workspace: workspace?.value,
      } });
      for (const name of ['documents', 'annotations', 'pages']) for (const row of manifest[name]) tx.objectStore(name).put(row);
      for (const file of files) tx.objectStore('files').put(file);
      tx.objectStore('state').put({ key: 'workspace', value: manifest.workspace });
    });
  }
  return { get, all, put, transaction, snapshot, replace, result,
    close: async () => { (await open()).close(); connection = null; },
  };
}

let library;
export function database() {
  if (!library) library = createLibraryDatabase(globalThis.indexedDB, 'quiet-margin:' + new URL(import.meta.env.BASE_URL, location.href).pathname);
  return library;
}
