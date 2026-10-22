import { supabase } from './supabase';

const SHELTER_PHOTO_BUCKET = 'shelter-photos';

/** Derives the public CDN URL from the stored object path (module35) —
 * the bucket is public-read (see that migration's own reasoning: a
 * shelter's photo is the same sensitivity tier as its already-openly-
 * queryable name/address/coordinates), so this never needs a signed URL
 * or an auth header. Null in, null out — a shelter with no photo yet. */
export function shelterPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(SHELTER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
