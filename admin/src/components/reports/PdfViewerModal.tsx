import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * The one shared "View PDF" surface (module25) every report — General,
 * WEDC/CNSP/CICL, and every role-specific report alike — opens into.
 *
 * Deliberately NOT a screenshot of anything: `pdfUrl` is a real
 * `blob:` URL produced by jsPDF's own `doc.output('bloburl')`, rendered
 * here through an <iframe>, which hands the ACTUAL PDF bytes to the
 * browser's own built-in PDF viewer (pagination, scrolling, zoom, its
 * own print/download controls are all genuinely native — nothing here
 * reimplements a PDF renderer). This satisfies "a dedicated PDF
 * preview interface ... must not simply display a screenshot" without
 * adding a new PDF-rendering dependency to the project.
 *
 * Export/Print here call back into the SAME jsPDF document the caller
 * already generated (see usePdfReportActions) — so View, Export, and
 * Print are always looking at identical bytes, never three different
 * generation passes that could silently drift apart.
 */
export function PdfViewerModal({
  title,
  pdfUrl,
  error,
  onClose,
  onExport,
  onPrint,
  printing,
}: {
  title: string;
  /** null while still generating, a blob: URL once ready. */
  pdfUrl: string | null;
  error?: string | null;
  onClose: () => void;
  onExport: () => void;
  onPrint: () => void;
  printing: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop pdf-viewer-backdrop" onMouseDown={onClose}>
      <div className="pdf-viewer-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: 15.5 }}>{title}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onPrint} disabled={!pdfUrl || printing}>
              <Printer size={13} /> {printing ? 'Preparing…' : 'Print PDF'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onExport} disabled={!pdfUrl}>
              <Download size={13} /> Export PDF
            </button>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close PDF preview">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="pdf-viewer-body">
          {error ? (
            <div className="pdf-viewer-state">
              <AlertTriangle size={28} color="var(--color-danger)" />
              <p style={{ marginTop: 10 }}>{error}</p>
            </div>
          ) : !pdfUrl ? (
            <div className="pdf-viewer-state">
              <Loader2 size={28} className="spin" color="var(--color-primary)" />
              <p style={{ marginTop: 10 }}>Generating report…</p>
            </div>
          ) : (
            <iframe ref={iframeRef} src={pdfUrl} title={title} className="pdf-viewer-frame" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
