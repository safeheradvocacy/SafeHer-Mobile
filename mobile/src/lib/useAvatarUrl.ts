import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { AVATAR_BUCKET } from './avatarPhoto';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** `avatars` is a private bucket (module37) — profile_picture now holds
 * a bare storage path, not a renderable URL, so every render site needs
 * a signed URL. Re-fetches whenever `path` changes, which already
 * happens naturally on every successful photo change (the path itself
 * is new/unique) and on remount (tab/screen navigation) — no separate
 * cache-busting parameter or background refresh timer is needed for an
 * avatar that's realistically only ever viewed for a few minutes per
 * screen visit, well inside the 1-hour signed-URL lifetime. */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error }) => {
        if (cancelled) return;
        setUrl(error ? null : (data?.signedUrl ?? null));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return url;
}
