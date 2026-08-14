import { openDB, type IDBPDatabase } from "idb";
import {
  encryptForStorage,
  decryptFromStorage,
  isStorageEncryptionReady,
  registerEncryptedDatabase,
} from "@/shared/crypto/storageEncryption";

const THUMB_SIZE = 200;
const DB_NAME = "uniffy-thumbnails";
// v2 stores encrypted ArrayBuffer values.
const DB_VERSION = 2;
const STORE_NAME = "thumbnails";

// Register so the database is wiped on seed rotation / device clear.
registerEncryptedDatabase(DB_NAME);

interface ThumbnailDB {
  thumbnails: {
    key: string;
    value: ArrayBuffer;
  };
}

let dbPromise: Promise<IDBPDatabase<ThumbnailDB>> | null = null;

function getDB(): Promise<IDBPDatabase<ThumbnailDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ThumbnailDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

async function getThumbnailFromCache(fileId: string): Promise<string | null> {
  try {
    if (!isStorageEncryptionReady()) return null;
    const db = await getDB();
    const encrypted = await db.get(STORE_NAME, fileId);
    if (!encrypted) return null;
    return await decryptFromStorage<string>(encrypted);
  } catch {
    return null;
  }
}

async function saveThumbnailToCache(fileId: string, dataUrl: string): Promise<void> {
  try {
    if (!isStorageEncryptionReady()) return;
    const db = await getDB();
    const encrypted = await encryptForStorage(dataUrl);
    await db.put(STORE_NAME, encrypted, fileId);
  } catch {
    // Caching is best-effort.
  }
}

export async function generateImageThumbnail(imageUrl: string, fileId: string): Promise<string> {
  const cached = await getThumbnailFromCache(fileId);
  if (cached) return cached;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = async () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        const ratio = Math.min(THUMB_SIZE / img.width, THUMB_SIZE / img.height);
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

        await saveThumbnailToCache(fileId, dataUrl);

        resolve(dataUrl);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = imageUrl;
  });
}

export async function clearThumbnailCache(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch {
    // best-effort
  }
}

export async function removeThumbnailFromCache(fileId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, fileId);
  } catch {
    // best-effort
  }
}
