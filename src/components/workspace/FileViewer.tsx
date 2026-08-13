'use client';

import { useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api } from '@/lib/client/api';
import Spinner from '@/components/Spinner';

type FileUrl = { url: string; name: string; mimeType: string | null };

/**
 * Vorschau und Download – die URL wird erst beim Öffnen kurzlebig signiert.
 *
 * Die Ansicht nimmt bewusst fast das ganze Fenster ein: Offerten sind mehrseitige
 * PDF mit Preistabellen, in einem kleinen Fenster wären sie nicht lesbar.
 */
export default function FileViewer({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const { reportError } = useFeedback();
  const [file, setFile] = useState<FileUrl | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await api<FileUrl>(`/api/files/${fileId}`);
        if (!cancelled) setFile(data);
      } catch (error) {
        if (!cancelled) {
          reportError(error, 'Die Datei konnte nicht geöffnet werden.');
          onClose();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, reportError, onClose]);

  // Mit Escape schliessen – im Vollbild ist das der schnellste Weg zurück.
  useEffect(() => {
    function beiTaste(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', beiTaste);
    return () => document.removeEventListener('keydown', beiTaste);
  }, [onClose]);

  const isImage = Boolean(file?.mimeType?.startsWith('image/'));
  const isPdf = file?.mimeType === 'application/pdf';

  async function herunterladen() {
    try {
      // Der Download braucht eine eigene, auf "attachment" signierte URL.
      const data = await api<FileUrl>(`/api/files/${fileId}?download=1`);
      window.location.href = data.url;
    } catch (error) {
      reportError(error, 'Download fehlgeschlagen.');
    }
  }

  return (
    <div
      className="viewer-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="viewer">
        <div className="viewer-kopf">
          <h3 title={file?.name}>{file?.name ?? 'Lade…'}</h3>
          <div className="viewer-aktionen">
            {file && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={herunterladen}
                >
                  ⬇ Herunterladen
                </button>
                <a
                  className="btn btn-ghost btn-sm"
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'none' }}
                  title="In einem eigenen Browser-Tab öffnen"
                >
                  ↗ Neuer Tab
                </a>
              </>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              title="Schliessen (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        <div className={`viewer-inhalt ${isImage ? 'bild' : ''}`}>
          {!file ? (
            <Spinner size={40} label="Datei wird geladen…" />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="viewer-img" src={file.url} alt={file.name} />
          ) : isPdf ? (
            <iframe className="viewer-pdf" src={file.url} title={file.name} />
          ) : (
            <div className="viewer-kein-vorschau">
              <p>Für diesen Dateityp gibt es keine Vorschau.</p>
              <button type="button" className="btn btn-accent" onClick={herunterladen}>
                ⬇ Herunterladen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
