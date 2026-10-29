import { MediaItem, UserPreferences } from '../types/media';

const IDB_NAME = 'cinevault_local_db';
const IDB_VERSION = 1;
const STORE_HANDLES = 'dir_handles';
const STORE_CATALOG = 'catalog_snapshots';

function openCineVaultIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_HANDLES)) {
          db.createObjectStore(STORE_HANDLES);
        }
        if (!db.objectStoreNames.contains(STORE_CATALOG)) {
          db.createObjectStore(STORE_CATALOG);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveDirectoryHandleToIdb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dirHandle: any
): Promise<void> {
  const db = await openCineVaultIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      tx.objectStore(STORE_HANDLES).put(dirHandle, 'primary_dir_handle');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDirectoryHandleFromIdb(): Promise<any | null> {
  const db = await openCineVaultIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_HANDLES, 'readonly');
      const req = tx.objectStore(STORE_HANDLES).get('primary_dir_handle');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function clearDirectoryHandleInIdb(): Promise<void> {
  const db = await openCineVaultIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      tx.objectStore(STORE_HANDLES).delete('primary_dir_handle');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function sanitizeMediaItemsForStorage(items: MediaItem[]): MediaItem[] {
  return items.map((item) => ({
    ...item,
    posterUrl: item.posterUrl?.startsWith('blob:') ? '' : item.posterUrl,
    bannerUrl: item.bannerUrl?.startsWith('blob:') ? '' : item.bannerUrl,
    episodes: item.episodes.map((ep) => {
      const restEp = { ...ep };
      delete restEp.clientFile;
      delete restEp.clientBlobUrl;
      return restEp;
    }),
  }));
}

export async function saveClientSnapshotToIdb(snapshot: {
  rootFolderName: string;
  items: MediaItem[];
  totalVideoFiles: number;
}): Promise<void> {
  const db = await openCineVaultIdb();
  const sanitized = {
    rootFolderName: snapshot.rootFolderName,
    items: sanitizeMediaItemsForStorage(snapshot.items),
    totalVideoFiles: snapshot.totalVideoFiles,
    updatedAt: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('cinevault_active_client_folder', snapshot.rootFolderName);
    } catch {}
  }

  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CATALOG, 'readwrite');
      tx.objectStore(STORE_CATALOG).put(sanitized, 'primary_client_snapshot');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadClientSnapshotFromIdb(): Promise<{
  rootFolderName: string;
  items: MediaItem[];
  totalVideoFiles: number;
  updatedAt: string;
} | null> {
  const db = await openCineVaultIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CATALOG, 'readonly');
      const req = tx.objectStore(STORE_CATALOG).get('primary_client_snapshot');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function checkDirectoryHandlePermission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dirHandle: any,
  requestIfPrompt = false
): Promise<'granted' | 'prompt' | 'denied'> {
  if (!dirHandle) return 'denied';
  try {
    if (typeof dirHandle.queryPermission === 'function') {
      const status = await dirHandle.queryPermission({ mode: 'read' });
      if (status === 'granted') return 'granted';
      if (status === 'prompt' && requestIfPrompt && typeof dirHandle.requestPermission === 'function') {
        const requested = await dirHandle.requestPermission({ mode: 'read' });
        return requested;
      }
      return status;
    }
    return 'granted';
  } catch {
    return 'denied';
  }
}

/**
 * Walks a granted FileSystemDirectoryHandle and re-attaches live `clientFile` and `clientBlobUrl`
 * to a restored MediaItem[] snapshot so playback works immediately after reload or browser restart!
 */
export async function rebindFilesFromDirectoryHandle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dirHandle: any,
  items: MediaItem[]
): Promise<{ items: MediaItem[]; boundCount: number }> {
  if (!dirHandle || !Array.isArray(items) || items.length === 0) {
    return { items, boundCount: 0 };
  }

  const rootFolderName: string = dirHandle.name || 'Selected Folder';
  const fileMap = new Map<string, File>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = async (handle: any, currentPath: string) => {
    for await (const entry of handle.values()) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = `${currentPath}/${entry.name}`;
      if (entry.kind === 'directory') {
        await walk(entry, entryPath);
      } else if (entry.kind === 'file') {
        try {
          const file: File = await entry.getFile();
          fileMap.set(entryPath.replace(/\\/g, '/'), file);
          fileMap.set(entry.name.toLowerCase(), file);
        } catch {}
      }
    }
  };

  try {
    await walk(dirHandle, rootFolderName);
  } catch {
    return { items, boundCount: 0 };
  }

  let boundCount = 0;
  const updatedItems = items.map((item) => {
    const nextEpisodes = item.episodes.map((ep) => {
      const normalizedRel = ep.relativePath.replace(/\\/g, '/');
      const matchedFile =
        fileMap.get(normalizedRel) || fileMap.get(ep.fileName.toLowerCase());
      if (matchedFile) {
        boundCount++;
        return {
          ...ep,
          clientFile: matchedFile,
          clientBlobUrl: URL.createObjectURL(matchedFile),
        };
      }
      return ep;
    });
    return {
      ...item,
      episodes: nextEpisodes,
    };
  });

  return { items: updatedItems, boundCount };
}

export function savePreferencesToLocalStorage(prefs: Partial<UserPreferences>): void {
  if (typeof window === 'undefined') return;
  try {
    const existingRaw = window.localStorage.getItem('cinevault_user_prefs');
    const existing = existingRaw ? JSON.parse(existingRaw) : {};
    window.localStorage.setItem(
      'cinevault_user_prefs',
      JSON.stringify({ ...existing, ...prefs })
    );
  } catch {}
}

export function loadPreferencesFromLocalStorage(): Partial<UserPreferences> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('cinevault_user_prefs');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
