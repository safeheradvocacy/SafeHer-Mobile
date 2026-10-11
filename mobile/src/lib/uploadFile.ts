import { File } from 'expo-file-system';

// Two things were tried and ruled out before this, both failing in this
// exact Expo Go + supabase-js bundling combination:
//   1. `fetch(uri).blob()` (the original code) — React Native's Blob is a
//      JS-side polyfill; storage-js wraps any Blob body in a FormData
//      part internally, and that path was unreliable here.
//   2. A hand-built FormData with a native { uri, name, type } file
//      descriptor — throws "Unsupported FormDataPart implementation"
//      inside storage-js's own body handling in this environment.
//
// A raw ArrayBuffer sidesteps both: storage-js sends it as a plain
// binary body with an explicit Content-Type header (see
// StorageFileApi.uploadOrUpdate's final `else` branch) — no Blob, no
// FormData, nothing for either polyfill layer to mishandle.
// `expo-file-system`'s new File API reads the local file straight into
// an ArrayBuffer without a base64 round-trip.
export async function readFileAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const file = new File(uri);
  return await file.arrayBuffer();
}
