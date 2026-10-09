/**
 * The app's IndexedDB key-value store: the only browser storage that can hold file and directory handles. Each call
 * opens and closes the database, so nothing stays locked between visits.
 */
const DB_NAME = "terraria-map-studio";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB is not available"));
    };
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => {
        resolve(request.result as T);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB request failed"));
      };
    });
  } finally {
    db.close();
  }
}

export async function readStored<T>(key: string): Promise<T | null> {
  return (await transact<T | undefined>("readonly", (store) => store.get(key))) ?? null;
}

export async function writeStored(key: string, value: unknown): Promise<void> {
  await transact("readwrite", (store) => store.put(value, key));
}

export async function deleteStored(key: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(key));
}
