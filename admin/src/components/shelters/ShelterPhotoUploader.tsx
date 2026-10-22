import React, { useRef, useState } from 'react';
import { ImageOff, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ConfirmDialog } from '../ui';
import {
  shelterPhotoUrl,
  uploadShelterPhoto,
  removeShelterPhotoFile,
  validateShelterPhoto,
} from '../../lib/shelterPhotos';

/**
 * Self-contained: uploading or removing a photo here saves immediately
 * (its own storage write + `shelters.photo_path` update), the same
 * "each section saves itself" convention ShelterInformationPage's other
 * cards already use (Shelter Details / Services, each with their own
 * Edit button and submit), rather than staging the photo as part of a
 * separate outer form's "Save changes" button. That's also what makes
 * "don't let the form look saved if the photo upload failed" true by
 * construction — there is no outer success state that could wrongly
 * cover for this one.
 *
 * Requires a real `shelterId` — the brief is explicit that a new
 * shelter's photo must never be saved before the shelter row itself
 * exists, so callers creating a new shelter don't render this at all
 * until the record has been created (see ShelterManagementPage).
 */
export function ShelterPhotoUploader({
  shelterId,
  photoPath,
  onChanged,
}: {
  shelterId: string;
  photoPath: string | null;
  onChanged: (path: string | null) => void;
}) {
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'removing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentUrl = shelterPhotoUrl(photoPath);

  const handleFile = async (file: File) => {
    const validationError = validateShelterPhoto(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setBusy('uploading');

    const { path, error: uploadErr } = await uploadShelterPhoto(shelterId, file);
    if (uploadErr || !path) {
      setBusy('idle');
      setError(uploadErr ?? 'Could not upload this photo.');
      return;
    }

    // DB update happens only after the new file is confirmed uploaded —
    // and the OLD file is only removed after THIS update succeeds (next
    // block), so a failure here never leaves the shelter pointing at
    // nothing while also never deleting a still-valid previous photo.
    const previousPath = photoPath;
    const { error: dbErr } = await supabase.from('shelters').update({ photo_path: path }).eq('shelter_id', shelterId);
    if (dbErr) {
      console.error('[ShelterPhotoUploader] save failed:', dbErr.message);
      // Orphan cleanup: the upload succeeded but the DB never pointed at
      // it, so remove the now-unreferenced file rather than leaving it
      // in storage forever.
      await removeShelterPhotoFile(path);
      setBusy('idle');
      setError('The photo uploaded but could not be saved to this shelter. Please try again.');
      return;
    }

    if (previousPath && previousPath !== path) {
      await removeShelterPhotoFile(previousPath);
    }
    setBusy('idle');
    onChanged(path);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file name later
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const confirmRemove = async () => {
    if (!photoPath) return;
    setShowRemoveConfirm(false);
    setBusy('removing');
    setError(null);
    const { error: dbErr } = await supabase.from('shelters').update({ photo_path: null }).eq('shelter_id', shelterId);
    if (dbErr) {
      console.error('[ShelterPhotoUploader] remove-save failed:', dbErr.message);
      setBusy('idle');
      setError('Could not remove this photo. Please try again.');
      return;
    }
    await removeShelterPhotoFile(photoPath);
    setBusy('idle');
    onChanged(null);
  };

  return (
    <div>
      <h4
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--color-text-muted)',
          marginBottom: 6,
        }}
      >
        Shelter Photos
      </h4>
      <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 10 }}>
        Upload photos to help users identify and learn about this shelter.
      </p>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div
          style={{
            width: 160,
            height: 120,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: 'var(--color-surface-muted)',
            border: `1px solid ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {busy !== 'idle' ? (
            <Loader2 size={22} className="auth-spinner" color="var(--color-primary)" />
          ) : currentUrl ? (
            <img src={currentUrl} alt="Shelter" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <ImageOff size={22} color="var(--color-text-muted)" />
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{
            flex: 1,
            minWidth: 200,
            border: `1px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: 16,
            textAlign: 'center',
            background: dragOver ? 'var(--color-primary-light)' : 'transparent',
          }}
        >
          <UploadCloud size={20} color="var(--color-text-muted)" style={{ marginBottom: 6 }} />
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Drag and drop an image here, or choose a file. JPEG, PNG, or WebP, up to 5 MB.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()} disabled={busy !== 'idle'}>
              {busy === 'uploading' ? 'Uploading...' : currentUrl ? 'Replace photo' : 'Upload photo'}
            </button>
            {currentUrl && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowRemoveConfirm(true)}
                disabled={busy !== 'idle'}
                style={{ color: 'var(--color-danger)' }}
              >
                <Trash2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                {busy === 'removing' ? 'Removing...' : 'Remove'}
              </button>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={onInputChange} />
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)', fontSize: 12.5, marginTop: 8 }}>{error}</p>}

      {showRemoveConfirm && (
        <ConfirmDialog
          title="Remove this shelter photo?"
          body="This photo will be permanently removed from this shelter's listing. This cannot be undone."
          confirmLabel="Remove photo"
          danger
          onCancel={() => setShowRemoveConfirm(false)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  );
}
