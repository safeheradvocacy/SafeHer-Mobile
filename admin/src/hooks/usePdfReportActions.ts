import { useCallback, useRef, useState } from 'react';
import type jsPDF from 'jspdf';

export type PdfActionState = 'idle' | 'viewing' | 'exporting' | 'printing';

/**
 * The one shared implementation of the four report actions (module25):
 * View PDF, Export PDF, Print PDF, plus the busy/duplicate-click guard
 * every caller needs. Every report page (General, WEDC/CNSP/CICL, and
 * every role-specific report) builds its jsPDF document differently
 * (buildDoc), but what happens with that document afterward — open it
 * in PdfViewerModal, trigger a real download, or print it — is
 * identical everywhere, so it lives here once instead of being
 * re-implemented per page.
 *
 * View and Print both generate a FRESH document on each call (rather
 * than caching one across the two) deliberately: the underlying
 * filters/data can change between the moment a user opens the viewer
 * and the moment they click Print inside it, and an operator must never
 * print something subtly different from what they most recently looked
 * at. Within a single Print click, the SAME generated document is what
 * gets displayed and printed — never two separate passes.
 */
export function usePdfReportActions({
  buildDoc,
  filename,
  onAudit,
}: {
  buildDoc: () => Promise<jsPDF>;
  /** Computed fresh at call time (report titles/filters can change between actions). */
  filename: () => string;
  // ANALYTICS_* added alongside the existing REPORT_* literals so the
  // Analytics PDF feature can log distinguishable audit actions through
  // this same shared hook, rather than either losing that distinction
  // or forking a second copy of this hook just to widen one type.
  onAudit?: (action: 'REPORT_VIEW_PDF' | 'REPORT_EXPORT_PDF' | 'REPORT_PRINT_PDF' | 'ANALYTICS_VIEW_PDF' | 'ANALYTICS_EXPORT_PDF' | 'ANALYTICS_PRINT_PDF', filename: string) => void;
}) {
  const [state, setState] = useState<PdfActionState>('idle');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const lastViewerBlobUrl = useRef<string | null>(null);
  const printFrame = useRef<HTMLIFrameElement | null>(null);

  const revokeViewerUrl = () => {
    if (lastViewerBlobUrl.current) {
      URL.revokeObjectURL(lastViewerBlobUrl.current);
      lastViewerBlobUrl.current = null;
    }
  };

  const view = useCallback(async () => {
    if (state !== 'idle') return;
    setState('viewing');
    setViewerOpen(true);
    setViewerUrl(null);
    setViewerError(null);
    try {
      const doc = await buildDoc();
      revokeViewerUrl();
      const url = doc.output('bloburl') as unknown as string;
      lastViewerBlobUrl.current = url;
      setViewerUrl(url);
      onAudit?.('REPORT_VIEW_PDF', filename());
    } catch (e) {
      console.error('[usePdfReportActions] view failed:', e);
      setViewerError('Unable to generate the report. Please try again.');
    } finally {
      setState('idle');
    }
  }, [state, buildDoc, filename, onAudit]);

  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    setViewerUrl(null);
    setViewerError(null);
    revokeViewerUrl();
  }, []);

  const exportPdf = useCallback(async () => {
    if (state !== 'idle') return null;
    setState('exporting');
    try {
      const doc = await buildDoc();
      const name = filename();
      doc.save(name);
      onAudit?.('REPORT_EXPORT_PDF', name);
      return name;
    } catch (e) {
      console.error('[usePdfReportActions] export failed:', e);
      throw e;
    } finally {
      setState('idle');
    }
  }, [state, buildDoc, filename, onAudit]);

  // Prints the ALREADY-open viewer's document (same bytes on screen) —
  // never a silent re-generation that could show one thing and print
  // another.
  const printViewerDoc = useCallback(() => {
    if (!viewerUrl || state !== 'idle') return;
    setState('printing');
    let frame = printFrame.current;
    if (!frame) {
      frame = document.createElement('iframe');
      frame.style.position = 'fixed';
      frame.style.right = '0';
      frame.style.bottom = '0';
      frame.style.width = '0';
      frame.style.height = '0';
      frame.style.border = '0';
      frame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(frame);
      printFrame.current = frame;
    }
    const onLoad = () => {
      try {
        frame!.contentWindow?.focus();
        frame!.contentWindow?.print();
      } catch (e) {
        console.error('[usePdfReportActions] print failed:', e);
      } finally {
        setState('idle');
      }
    };
    frame.onload = onLoad;
    frame.src = viewerUrl;
  }, [viewerUrl]);

  // Standalone Print action (no viewer open) — generates once, prints
  // through the same hidden-iframe mechanism as printViewerDoc.
  const printPdf = useCallback(async () => {
    if (state !== 'idle') return;
    setState('printing');
    try {
      const doc = await buildDoc();
      const url = doc.output('bloburl') as unknown as string;
      let frame = printFrame.current;
      if (!frame) {
        frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.right = '0';
        frame.style.bottom = '0';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        frame.setAttribute('aria-hidden', 'true');
        document.body.appendChild(frame);
        printFrame.current = frame;
      }
      await new Promise<void>((resolve) => {
        frame!.onload = () => resolve();
        frame!.src = url;
      });
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      onAudit?.('REPORT_PRINT_PDF', filename());
    } catch (e) {
      console.error('[usePdfReportActions] print failed:', e);
    } finally {
      setState('idle');
    }
  }, [state, buildDoc, filename, onAudit]);

  return {
    state,
    busy: state !== 'idle',
    viewerOpen,
    viewerUrl,
    viewerError,
    view,
    closeViewer,
    exportPdf,
    printPdf,
    printViewerDoc,
    printing: state === 'printing',
  };
}
