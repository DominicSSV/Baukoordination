'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtSize } from '@/lib/format';
import Spinner from '@/components/Spinner';
import type { ProjectDetail } from '@/types';

export default function FilesTab({
  detail,
  reload,
  onOpenFile,
}: {
  detail: ProjectDetail;
  reload: () => Promise<void>;
  onOpenFile: (fileId: string) => void;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | File[] | null) {
    if (!files || !('length' in files) || !files.length) return;

    setUploading(true);
    try {
      const result = await uploadFiles({ projectId: detail.project.id, files });
      await reload();

      if (result.errors.length) {
        reportError(new Error(result.errors.join(' · ')), 'Upload fehlgeschlagen.');
      }
      if (result.uploaded) toast(`✓ ${result.uploaded} Datei(en) hochgeladen.`);
    } catch (error) {
      reportError(error, 'Upload fehlgeschlagen.');
    } finally {
      setUploading(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  }

  return (
    <div className="card">
      <div className="section-head">
        <h2>Fotos &amp; Dokumente</h2>
      </div>

      <div
        className={`dropzone ${dragging ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="dz-icon">
          {uploading ? <Spinner size={36} /> : '📥'}
        </div>
        <div>
          {uploading ? (
            <strong>Dateien werden hochgeladen…</strong>
          ) : (
            <>
              <strong>Dateien hierher ziehen</strong> oder Foto aufnehmen
            </>
          )}
        </div>
        <div className="dz-buttons">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            📁 Datei wählen
          </button>
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={() => cameraInput.current?.click()}
            disabled={uploading}
          >
            📷 Foto aufnehmen
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {detail.files.length ? (
        <div className="files-grid">
          {detail.files.map((f) => {
            const linkedTodo = f.todo_id
              ? detail.todos.find((t) => t.id === f.todo_id)
              : null;

            return (
              <div key={f.id} className="file-card">
                {f.can_delete && (
                  <button
                    type="button"
                    className="file-del"
                    title="Löschen"
                    onClick={() =>
                      confirm('Diese Datei wirklich löschen?', async () => {
                        await del(`/api/files/${f.id}`);
                        await reload();
                        toast('🗑️ Datei gelöscht.');
                      })
                    }
                  >
                    ✕
                  </button>
                )}

                {f.thumb_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="file-thumb"
                    src={f.thumb_url}
                    alt={f.name}
                    loading="lazy"
                    onClick={() => onOpenFile(f.id)}
                  />
                ) : (
                  <button
                    type="button"
                    className="file-thumb-doc"
                    onClick={() => onOpenFile(f.id)}
                  >
                    📄
                  </button>
                )}

                <div className="file-info">
                  <div className="file-name" title={f.name}>
                    {f.name}
                  </div>
                  <div className="file-meta">
                    {fmtSize(f.size_bytes)} · {f.uploaded_by}
                  </div>
                  {linkedTodo && (
                    <div className="file-linked-todo" title={linkedTodo.text}>
                      🔗 {linkedTodo.text}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '20px 10px' }}>
          <p>Noch keine Dateien hochgeladen.</p>
        </div>
      )}
    </div>
  );
}
