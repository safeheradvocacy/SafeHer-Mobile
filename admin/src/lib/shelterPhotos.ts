import { supabase } from './supabase';

export const SHELTER_PHOTO_BUCKET = 'shelter-photos';
export const MAX_SHELTER_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — matches the bucket's own file_size_limit (module35)
export const ACCEPTED_SHELTER_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function shelterPhotoUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(SHELTER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Validates the browser's own sniffed MIME type (`file.type`), not the
 * filename extension — a renamed .txt-to-.jpg still reports its real
 * type here, since the browser determines `file.type` from the file's
 * actual bytes/magic number, not its name. Storage's own
 * allowed_mime_types also re-checks this server-side regardless (module35),
 * so a spoofed client is still caught even if this check were bypassed. */
export function validateShelterPhoto(file: File): string | null {
  if (!ACCEPTED_SHELTER_PHOTO_TYPES.includes(file.type)) {
    return 'Please choose a JPEG, PNG, or WebP image.';
  }
  if (file.size > MAX_SHELTER_PHOTO_BYTES) {
    return 'This image is larger than 5 MB. Please choose a smaller file.';
  }
  return null;
}

/** Uploads to shelters/<shelterId>/<unique filename>, matching the
 * brief's own recommended path structure and this project's established
 * `${ownerId}/${Date.now()}_${name}` uniqueness convention. Returns the
 * storage path to save on the shelter row — never the public URL itself
 * (see the Shelter.photo_path comment for why). */
export async function uploadShelterPhoto(shelterId: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const validationError = validateShelterPhoto(file);
  if (validationError) return { path: null, error: validationError };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `shelters/${shelterId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from(SHELTER_PHOTO_BUCKET).upload(path, file, { contentType: file.type });
  if (error) {
    console.error('[shelterPhotos] upload failed:', error.message);
    return { path: null, error: 'Could not upload this photo. Please try again.' };
  }
  return { path, error: null };
}

export async function removeShelterPhotoFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(SHELTER_PHOTO_BUCKET).remove([path]);
  if (error) console.error('[shelterPhotos] remove failed:', error.message);
}
