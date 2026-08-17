'use client';

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, patch, post } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtSize, fmtDate } from '@/lib/format';
import Spinner from '@/components/Spinner';
import Avatar from '@/components/Avatar';
import { findPerson, personLabel } from '@/lib/people';
import UploadNamesModal from '@/components/workspace/UploadNamesModal';
import type { ProjectDetail, ProjectFile, SessionInfo } from '@/types';

/**
 * Register "Dokumente": Pläne, Schemas und Datenblätter, gegliedert nach Gewerk.
 *
 * Anders als bei den Offerten sieht hier jeder alles, der Zugriff auf das
 * Projekt hat – der Elektriker muss das DC-Schema lesen können. Die Gliederung
 * verwaltet allein die Swiss Solar Ventures AG; die Sperre dafür steht in der
 * Datenbank (Migration 0019) und nicht erst in dieser Ansicht.
 */
export default function DocumentsTab({
  detail,
  session,
  isAdmin,
  reload,
  onOpenFile,
}: {
  detail: ProjectDetail;
  session: SessionInfo;
  isAdmin: boolean;
  reload: () => Promise<void>;
  onOpenFile: (fileId: string) => void;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [uploadIn, setUploadIn] = useState<string | null>(null);
  const [ziehtUeber, setZiehtUeber] = useState<string | null>(null);
  const [zu, setZu] = useState<Set<string>>(new Set());
  const [wartend, setWartend] = useState<{ ordner: string; files: File[] } | null>(null);
  const [neuerOrdner, setNeuerOrdner] = useState<string | null>(null);
  const [umbenennen, setUmbenennen] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const ordner = detail.documentFolders;

  /** Dokumente je Ordner, neueste zuoberst (so kommen sie schon aus der Abfrage). */
  const nachOrdner = useMemo(() => {
    const map = new Map<string, ProjectFile[]>();
    for (const o of ordner) map.set(o.id, []);
    for (const f of detail.files) {
      if (f.document_folder && map.has(f.document_folder)) {
        map.get(f.document_folder)!.push(f);
      }
    }
    return map;
  }, [detail.files, ordner]);

  function auswaehlen(ordnerId: string, files: FileList | File[] | null) {
    if (!files || !('length' in files) || !files.length) return;
    setWartend({ ordner: ordnerId, files: Array.from(files) });
  }

  async function hochladen(namen: string[]) {
    const auftrag = wartend;
    setWartend(null);
    if (!auftrag) return;

    setUploadIn(auftrag.ordner);
    try {
      const result = await uploadFiles({
        projectId: detail.project.id,
        documentFolder: auftrag.ordner,
        files: auftrag.files,
        namen,
      });
      await reload();

      if (result.errors.length) {
        reportError(new Error(result.errors.join(' · ')), 'Upload fehlgeschlagen.');
      }
      if (result.uploaded) toast(`✓ ${result.uploaded} Dokument(e) abgelegt.`);
    } catch (error) {
      reportError(error, 'Upload fehlgeschlagen.');
    } finally {
      setUploadIn(null);
    }
  }

  function klappen(ordnerId: string) {
    setZu((current) => {
      const next = new Set(current);
      if (next.has(ordnerId)) next.delete(ordnerId);
      else next.add(ordnerId);
      return next;
    });
  }

  async function anlegen() {
    const name = (neuerOrdner ?? '').trim();
    if (!name || busy) return;

    setBusy(true);
    try {
      await post(`/api/projects/${detail.project.id}/document-folders`, { name });
      setNeuerOrdner(null);
      await reload();
      toast(`✓ Ordner „${name}“ angelegt.`);
    } catch (error) {
      reportError(error, 'Ordner konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  }

  async function umbenennenSpeichern() {
    const entwurf = umbenennen;
    if (!entwurf || busy) return;

    const name = entwurf.name.trim();
    if (!name) return;

    setBusy(true);
    try {
      await patch(`/api/projects/${detail.project.id}/document-folders`, {
        ordnerId: entwurf.id,
        name,
      });
      setUmbenennen(null);
      await reload();
    } catch (error) {
      reportError(error, 'Umbenennen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  function ordnerLoeschen(id: string, name: string, anzahl: number) {
    // Der Server prüft das ebenfalls – hier steht es, damit gar nicht erst
    // jemand mit einer Fehlermeldung dasteht.
    if (anzahl > 0) {
      reportError(
        new Error(
          `„${name}“ enthält noch ${anzahl} Dokument(e). Bitte zuerst wegräumen.`,
        ),
        'Ordner nicht gelöscht.',
      );
      return;
    }

    confirm(`Ordner „${name}“ löschen?`, async () => {
      await del(`/api/projects/${detail.project.id}/document-folders`, {
        ordnerId: id,
      });
      await reload();
      toast('🗑️ Ordner gelöscht.');
    });
  }

  return (
    <div className="card">
      {wartend && (
        <UploadNamesModal
          files={wartend.files}
          titel={`Ablegen unter „${
            ordner.find((o) => o.id === wartend.ordner)?.name ?? 'Dokumente'
          }“`}
          onAbbrechen={() => setWartend(null)}
          onBestaetigen={hochladen}
        />
      )}

      <div className="section-head">
        <h2>Dokumente</h2>
        {isAdmin && neuerOrdner === null && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setNeuerOrdner('')}
          >
            + Ordner
          </button>
        )}
      </div>

      <p className="offer-hinweis">
        Pläne, Schemas und Datenblätter. Diese Unterlagen sehen alle, die Zugriff
        auf das Projekt haben – anders als die Offerten.
        {isAdmin && ' Die Ordner verwaltest nur du.'}
      </p>

      {isAdmin && neuerOrdner !== null && (
        <div className="ordner-form">
          <input
            type="text"
            value={neuerOrdner}
            autoFocus
            maxLength={60}
            placeholder="Name des Ordners, z.B. Wärmepumpe"
            onChange={(e) => setNeuerOrdner(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void anlegen();
              if (e.key === 'Escape') setNeuerOrdner(null);
            }}
          />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={anlegen}
            disabled={busy || !neuerOrdner.trim()}
          >
            Anlegen
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setNeuerOrdner(null)}
          >
            Abbrechen
          </button>
        </div>
      )}

      {!ordner.length && (
        <p className="offer-hinweis">
          Es sind noch keine Ordner da. Sie kommen mit der Datenbank-Aktualisierung
          0019 – oder du legst dir eigene an.
        </p>
      )}

      {ordner.map((o) => {
        const dateien = nachOrdner.get(o.id) ?? [];
        const eingeklappt = zu.has(o.id);
        const laedt = uploadIn === o.id;

        if (umbenennen?.id === o.id) {
          return (
            <div className="ordner-form" key={o.id}>
              <input
                type="text"
                value={umbenennen.name}
                autoFocus
                maxLength={60}
                onChange={(e) =>
                  setUmbenennen({ id: o.id, name: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void umbenennenSpeichern();
                  if (e.key === 'Escape') setUmbenennen(null);
                }}
              />
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={umbenennenSpeichern}
                disabled={busy || !umbenennen.name.trim()}
              >
                Speichern
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setUmbenennen(null)}
              >
                Abbrechen
              </button>
            </div>
          );
        }

        return (
          <div className="offer-ordner" key={o.id}>
            <div className="ordner-kopf-zeile">
              <button
                type="button"
                className="offer-kopf"
                onClick={() => klappen(o.id)}
                aria-expanded={!eingeklappt}
              >
                <span className={`gruppe-pfeil ${eingeklappt ? 'zu' : ''}`}>▾</span>
                <span className="offer-icon" aria-hidden="true">
                  🗂️
                </span>
                <span className="offer-titel">{o.name}</span>
                <span className="gruppe-anzahl">{dateien.length}</span>
              </button>

              {isAdmin && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Umbenennen"
                    onClick={() => setUmbenennen({ id: o.id, name: o.name })}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={
                      dateien.length
                        ? 'Erst leeren – der Ordner enthält noch Dokumente'
                        : 'Ordner löschen'
                    }
                    onClick={() => ordnerLoeschen(o.id, o.name, dateien.length)}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>

            {!eingeklappt && (
              <div className="offer-inhalt">
                <div
                  className={`offer-dropzone ${ziehtUeber === o.id ? 'drag' : ''}`}
                  onDragOver={(e: DragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    setZiehtUeber(o.id);
                  }}
                  onDragLeave={() => setZiehtUeber(null)}
                  onDrop={(e: DragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    setZiehtUeber(null);
                    auswaehlen(o.id, e.dataTransfer.files);
                  }}
                >
                  {laedt ? (
                    <>
                      <Spinner size={22} />
                      <span>Wird hochgeladen…</span>
                    </>
                  ) : (
                    <>
                      <span>
                        Datei hierher ziehen für <strong>{o.name}</strong>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => inputs.current[o.id]?.click()}
                        disabled={Boolean(uploadIn)}
                      >
                        📁 Datei wählen
                      </button>
                    </>
                  )}
                  <input
                    ref={(el) => {
                      inputs.current[o.id] = el;
                    }}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      auswaehlen(o.id, e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>

                {dateien.length ? (
                  <div className="offer-liste">
                    {dateien.map((f) => {
                      const person = findPerson(detail, {
                        name: f.uploaded_by,
                        supplierId: f.uploaded_by_supplier_id,
                      });
                      const eigen =
                        session.kind === 'supplier' &&
                        f.uploaded_by_supplier_id === session.supplierId;

                      return (
                        <div className="offer-zeile" key={f.id}>
                          <button
                            type="button"
                            className="offer-name"
                            onClick={() => onOpenFile(f.id)}
                            title="Öffnen"
                          >
                            📎 {f.name}
                          </button>
                          <div className="offer-meta">
                            <Avatar
                              url={person.avatarUrl}
                              name={f.uploaded_by}
                              size={20}
                            />
                            <span>
                              {eigen ? 'von dir' : personLabel(person)} ·{' '}
                              {fmtSize(f.size_bytes)} · {fmtDate(f.uploaded_at)}
                            </span>
                          </div>
                          {f.can_delete && (
                            <button
                              type="button"
                              className="icon-btn"
                              title="Entfernen"
                              onClick={() =>
                                confirm(`„${f.name}“ wirklich entfernen?`, async () => {
                                  await del(`/api/files/${f.id}`);
                                  await reload();
                                  toast('🗑️ Dokument entfernt.');
                                })
                              }
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="offer-leer">Noch nichts abgelegt.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
