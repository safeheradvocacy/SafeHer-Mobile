import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from './supabase';
import { readFileAsArrayBuffer } from './uploadFile';

export const AVATAR_BUCKET = 'avatars';
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TARGET_DIMENSION = 1024;

export type PhotoQuota = {
  used: number;
  remaining: number;
  /** ISO timestamp, or null when `remaining > 0`. Always a real
   * server-computed value from get_profile_photo_quota() — never
   * derived client-side. */
  nextEligibleAt: string | null;
};

export type CommitResult = {
  success: boolean;
  remaining: number;
  nextEligibleAt: string | null;
  previousPath: string | null;
  errorCode: 'limit_reached' | null;
};

// module37's Postgres functions aren't declared in this project's
// hand-maintained database.types.ts (only tables are) — `data` comes
// back untyped from supabase-js, so its shape is asserted here the same
// way CaseAccessScreen.tsx already does for redeem_case_access_token().
type QuotaRow = { used: number; remaining: number; next_eligible_at: string | null };
type CommitRow = {
  success: boolean;
  remaining: number;
  next_eligible_at: string | null;
  previous_path: string | null;
  error_code: 'limit_reached' | null;
};

/** Reads the caller's own rolling-7-day/3-change quota. Server-
 * authoritative — this is a direct RPC to get_profile_photo_quota()
 * (module37), never a client-side count. */
export async function fetchPhotoQuota(): Promise<PhotoQuota> {
  const { data, error } = await supabase.rpc('get_profile_photo_quota').single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to load your photo-change quota.');
  }
  const row = data as unknown as QuotaRow;
  return {
    used: row.used,
    remaining: row.remaining,
    nextEligibleAt: row.next_eligible_at,
  };
}

/** Records a photo change that has ALREADY been uploaded to storage at
 * `photoPath`. The server (module37's commit_profile_photo_change)
 * re-validates the quota atomically and is the real enforcement
 * boundary — this call can still come back rejected even if the client
 * believed it had quota remaining (e.g. a second device used it up a
 * moment earlier). */
export async function commitPhotoChange(photoPath: string): Promise<CommitResult> {
  const { data, error } = await supabase.rpc('commit_profile_photo_change', { p_photo_path: photoPath }).single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to save your new profile photo.');
  }
  const row = data as unknown as CommitRow;
  return {
    success: row.success,
    remaining: row.remaining,
    nextEligibleAt: row.next_eligible_at,
    previousPath: row.previous_path,
    errorCode: row.error_code,
  };
}

/** Formats a server-computed next-eligible timestamp for display.
 * Deliberately never claims a fixed reset day/time ("resets Monday") —
 * the rolling window means the real answer is whatever the server
 * returned. */
export function formatNextEligible(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export class AvatarProcessingError extends Error {}

/** Re-encodes the (already natively cropped, square) picked image into a
 * normalized JPEG under MAX_AVATAR_BYTES. This is also the "validate
 * it's actually a real image" step — expo-image-manipulator must
 * successfully decode the source to produce any output at all, so a
 * renamed non-image file fails here with a thrown error rather than
 * silently uploading garbage bytes. Resizing to a fixed square also
 * guards against a corrupted/mismatched crop result. Quality is backed
 * off in steps if the first pass is still over the size cap, rather
 * than rejecting a perfectly reasonable photo outright. */
export async function processAvatarImage(uri: string): Promise<{ uri: string; width: number; height: number; size: number }> {
  let quality = 0.85;
  let result = await (await ImageManipulator.manipulate(uri).resize({ width: AVATAR_TARGET_DIMENSION, height: AVATAR_TARGET_DIMENSION }).renderAsync()).saveAsync({
    compress: quality,
    format: SaveFormat.JPEG,
  });

  let size = new File(result.uri).size;
  while (size > MAX_AVATAR_BYTES && quality > 0.35) {
    quality -= 0.15;
    result = await (await ImageManipulator.manipulate(result.uri).renderAsync()).saveAsync({ compress: quality, format: SaveFormat.JPEG });
    size = new File(result.uri).size;
  }

  if (size === 0) {
    throw new AvatarProcessingError('That file could not be read as an image. Please choose another photo.');
  }
  if (size > MAX_AVATAR_BYTES) {
    throw new AvatarProcessingError('This photo is too large even after compression. Please choose a different photo.');
  }

  return { uri: result.uri, width: result.width, height: result.height, size };
}

/** Uploads an already-processed local file to this user's own avatars
 * folder at a fresh, unique path — never the filename or MIME type the
 * client happened to report, always a path this function controls and
 * a fixed `image/jpeg` content type matching what processAvatarImage()
 * actually produced. */
export async function uploadAvatarImage(profileId: string, localUri: string): Promise<string> {
  const path = `${profileId}/${Date.now()}.jpg`;
  const buffer = await readFileAsArrayBuffer(localUri);
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    throw new Error(error.message || 'Unable to upload your profile photo.');
  }
  return path;
}

/** Best-effort cleanup of an orphaned object — used both when a
 * replace succeeds (removing the OLD photo) and when an upload
 * succeeded but the commit was rejected (removing the just-uploaded,
 * never-committed object). Never surfaced to the user as an error —
 * losing a stray object is harmless and silently retried implicitly
 * the next time this path is ever touched. */
export async function removeAvatarObject(path: string | null): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  if (error) {
    console.warn('[avatarPhoto] cleanup remove failed:', error.message);
  }
}
