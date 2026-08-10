'use client';

import { useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api } from '@/lib/client/api';

type FileUrl = { url: string; name: string; mimeType: string | null };

/** Vorschau und Download – die URL wird erst beim Öffnen kurzlebig signiert. */
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

  const isImage = Boolean(file?.mimeType?.startsWith('image/'));
  const isPdf = file?.mimeType === 'application/pdf';

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 720 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            gap: 10,
          }}
        >
          <h3 style={{ fontSize: 16, minWidth: 0, overflowWrap: 'anywhere' }}>
            {file?.name ?? 'Lade…'}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {!file ? (
          <p>
            <span className="spin">⏳</span> Datei wird geladen…
          </p>
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="modal-img" src={file.url} alt={file.name} />
        ) : isPdf ? (
          <iframe
            src={file.url}
            title={file.name}
            style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: 8 }}
          />
        ) : (
          <p>Für diesen Dateityp gibt es keine Vorschau – bitte herunterladen.</p>
        )}

        {file && (
          <div style={{ marginTop: 14, textAlign: 'right' }}>
            <a
              className="btn btn-ghost"
              href={`/api/files/${fileId}?download=1`}
              style={{ textDecoration: 'none' }}
              onClick={async (e) => {
                // Der Download braucht eine eigene, auf "attachment" signierte URL.
                e.preventDefault();
                try {
                  const data = await api<FileUrl>(`/api/files/${fileId}?download=1`);
                  window.location.href = data.url;
                } catch (error) {
                  reportError(error, 'Download fehlgeschlagen.');
                }
              }}
            >
              ⬇ Herunterladen
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
