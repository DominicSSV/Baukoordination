'use client';

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtSize } from '@/lib/format';
import Spinner from '@/components/Spinner';
import Avatar from '@/components/Avatar';
import { findPerson, personLabel } from '@/lib/people';
import { ordnerName } from '@/lib/offers';
import UploadNamesModal from '@/components/workspace/UploadNamesModal';
import type { ProjectDetail, ProjectFile } from '@/types';

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
  // Erst benennen, dann hochladen – "IMG_4711.jpg" hilft später niemandem.
  const [wartend, setWartend] = useState<File[] | null>(null);
  const [suche, setSuche] = useState('');
  const [ablage, setAblage] = useState('');
  const [wer, setWer] = useState('');

  function handleFiles(files: FileList | File[] | null) {
    if (!files || !('length' in files) || !files.length) return;
    setWartend(Array.from(files));
  }

  async function hochladen(namen: string[]) {
    const files = wartend;
    setWartend(null);
    if (!files) return;

    setUploading(true);
    try {
      const result = await uploadFiles({ projectId: detail.project.id, files, namen });
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

  /**
   * Woher eine Datei stammt, als lesbarer Pfad – z.B.
   * „Dokumente · Photovoltaik · Bewilligung“ oder „Offerten · Auftragsbestätigung“.
   *
   * Hier laufen alle Dateien des Projekts zusammen; ohne die Herkunft weiss man
   * bei „IA_PVA-DC …“ nicht mehr, wo sie eigentlich abgelegt ist.
   */
  function herkunft(f: ProjectFile): string | null {
    if (f.offer_folder) {
      const name = ordnerName(f.offer_folder);
      if (!name) return null;
      // „Offerten · Offerten“ wäre albern – der Ordner heisst wie das Register.
      return name === 'Offerten' ? name : `Offerten · ${name}`;
    }

    if (f.document_folder) {
      const ordner = detail.documentFolders.find((o) => o.id === f.document_folder);
      if (!ordner) return 'Dokumente';
      const eltern = ordner.parent_id
        ? detail.documentFolders.find((o) => o.id === ordner.parent_id)
        : null;
      return eltern
        ? `Dokumente · ${eltern.name} · ${ordner.name}`
        : `Dokumente · ${ordner.name}`;
    }

    return null;
  }

  /** Grobe Einteilung für den Filter – dieselben Töpfe wie in der Herkunft. */
  function ablageArt(f: ProjectFile): string {
    if (f.offer_folder) return 'offerten';
    if (f.document_folder) return 'dokumente';
    if (f.todo_id) return 'todo';
    return 'frei';
  }

  const hochlader = useMemo(
    () => Array.from(new Set(detail.files.map((f) => f.uploaded_by))).sort(),
    [detail.files],
  );

  const dateien = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return detail.files.filter(
      (f) =>
        (!ablage || ablageArt(f) === ablage) &&
        (!wer || f.uploaded_by === wer) &&
        (!begriff || f.name.toLowerCase().includes(begriff)),
    );
  }, [detail.files, suche, ablage, wer]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  }

  return (
    <div className="card">
      {wartend && (
        <UploadNamesModal
          files={wartend}
          titel="Dateien benennen"
          onAbbrechen={() => setWartend(null)}
          onBestaetigen={hochladen}
        />
      )}

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
            handleFiles(e.target.files);
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
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {detail.files.length > 6 && (
        <div className="filter-leiste">
          <input
            type="text"
            className="filter-feld"
            value={suche}
            placeholder="Dateiname suchen…"
            onChange={(e) => setSuche(e.target.value)}
          />
          <select value={ablage} onChange={(e) => setAblage(e.target.value)}>
            <option value="">Alle Ablagen</option>
            <option value="dokumente">Dokumente</option>
            <option value="offerten">Offerten</option>
            <option value="todo">An einem To-Do</option>
            <option value="frei">Ohne Zuordnung</option>
          </select>
          <select value={wer} onChange={(e) => setWer(e.target.value)}>
            <option value="">Alle Personen</option>
            {hochlader.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {(suche || ablage || wer) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSuche('');
                setAblage('');
                setWer('');
              }}
            >
              Zurücksetzen
            </button>
          )}
          <span className="filter-anzahl">
            {dateien.length} von {detail.files.length}
          </span>
        </div>
      )}

      {dateien.length ? (
        <div className="files-grid">
          {dateien.map((f) => {
            const linkedTodo = f.todo_id
              ? detail.todos.find((t) => t.id === f.todo_id)
              : null;
            const person = findPerson(detail, {
              name: f.uploaded_by,
              supplierId: f.uploaded_by_supplier_id,
            });

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
                  <div className="file-meta file-meta-person">
                    <Avatar url={person.avatarUrl} name={f.uploaded_by} size={16} />
                    {fmtSize(f.size_bytes)} · {personLabel(person)}
                  </div>
                  {herkunft(f) && (
                    <div className="file-offer-tag" title={herkunft(f) ?? ''}>
                      {herkunft(f)}
                    </div>
                  )}
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
          <p>
            {detail.files.length
              ? 'Keine Datei passt zu diesem Filter.'
              : 'Noch keine Dateien hochgeladen.'}
          </p>
        </div>
      )}
    </div>
  );
}
