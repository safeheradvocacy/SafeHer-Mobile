import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Supabase Auth session storage adapter, backed by expo-secure-store
 * (Android Keystore / iOS Keychain) instead of plain AsyncStorage.
 *
 * WHY — AsyncStorage on Android is a private, sandboxed SQLite file;
 * ordinary apps can't read another app's, but it is NOT hardware-
 * encrypted, and (before this change) nothing stopped it from being
 * pulled off the device via a full-device/ADB backup (see
 * android.allowBackup in app.config.ts, now also disabled). SafeSpace
 * stores a live Supabase session token here — on a device that could be
 * shared, borrowed, or seized in exactly the kind of situation this app
 * exists for, that's worth the hardening.
 *
 * WHY CHUNKED — SecureStore enforces a ~2048-byte limit per value
 * (Android Keystore constraint), and a Supabase session JSON (access
 * token + refresh token + user metadata) can exceed that. This splits
 * a value across multiple SecureStore keys and reassembles on read,
 * rather than failing to store a session that's "too long."
 *
 * WHY THE ASYNCSTORAGE FALLBACK — this app shipped with an
 * AsyncStorage-backed session storage before this change. Swapping the
 * adapter outright would make every existing signed-in user's session
 * invisible on their next app open (same key, totally different
 * storage backend) — effectively forcing a mass, silent logout. Every
 * read checks SecureStore first; if nothing is there, it falls back to
 * the OLD AsyncStorage location exactly once, migrates that value into
 * SecureStore, deletes it from AsyncStorage, and returns it. A device
 * that was never on the old version simply never hits the fallback
 * path (no stray reads it would never resolve).
 */
const CHUNK_SIZE = 1800; // safety margin under SecureStore's ~2048-byte per-value limit
const CHUNK_COUNT_SUFFIX = '.chunks';

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function readChunked(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX);
  if (countRaw == null) return null;
  const count = parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count < 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    // A missing chunk means the stored value is corrupt/partial — fail
    // closed (treat as absent) rather than return a truncated session.
    if (part == null) return null;
    parts.push(part);
  }
  return parts.join('');
}

async function writeChunked(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push('');
  await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk)));
  await SecureStore.setItemAsync(key + CHUNK_COUNT_SUFFIX, String(chunks.length));
}

async function deleteChunked(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX).catch(() => null);
  if (countRaw != null) {
    const count = parseInt(countRaw, 10);
    if (Number.isFinite(count) && count >= 0) {
      await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i)).catch(() => {})));
    }
  }
  await SecureStore.deleteItemAsync(key + CHUNK_COUNT_SUFFIX).catch(() => {});
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const value = await readChunked(key);
      if (value != null) return value;
    } catch (e) {
      console.error('[secureSessionStorage] getItem (SecureStore):', e);
    }

    // One-time migration path — see file header. Never logs the
    // session value itself.
    try {
      const legacy = await AsyncStorage.getItem(key);
      if (legacy != null) {
        await writeChunked(key, legacy).catch((e) => console.error('[secureSessionStorage] migration write:', e));
        await AsyncStorage.removeItem(key).catch(() => {});
        return legacy;
      }
    } catch (e) {
      console.error('[secureSessionStorage] getItem (legacy AsyncStorage fallback):', e);
    }
    return null;
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await writeChunked(key, value);
    } catch (e) {
      console.error('[secureSessionStorage] setItem:', e);
    }
  },

  async removeItem(key: string): Promise<void> {
    await deleteChunked(key).catch((e) => console.error('[secureSessionStorage] removeItem:', e));
    // Also clear any not-yet-migrated legacy value, so a stale pre-
    // migration session can never resurface after an explicit sign-out.
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};
