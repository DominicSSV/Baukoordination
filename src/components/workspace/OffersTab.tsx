'use client';

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, post } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtSize, fmtDate } from '@/lib/format';
import Spinner from '@/components/Spinner';
import Avatar from '@/components/Avatar';
import { findPerson, personLabel } from '@/lib/people';
import { OFFERTEN_ORDNER, ordnerName } from '@/lib/offers';
import UploadNamesModal from '@/components/workspace/UploadNamesModal';
import type { ProjectDetail, ProjectFile, SessionInfo } from '@/types';

/**
 * Register "Offerten": feste Ordner, in die Lieferanten ihre Unterlagen legen.
 * Sichtbar sind sie nur für uns und die Firma, die sie eingereicht hat – dafür
 * sorgen die Datenbank (Migrationen 0012/0013) und die Datei-Route, nicht erst
 * diese Ansicht.
 */
export default function OffersTab({
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
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  // Erst benennen, dann hochladen – Dateinamen wie "OFFERT~1.PDF" sagen nichts aus.
  const [wartend, setWartend] = useState<{ ordner: string; files: File[] } | null>(null);
  // Geöffnete Anmerkungslisten und die Entwürfe dazu, je Datei.
  const [offeneNotizen, setOffeneNotizen] = useState<Set<string>>(new Set());
  const [entwuerfe, setEntwuerfe] = useState<Record<string, string>>({});

  /** Dateien nach Ordner, in der Reihenfolge des Katalogs. */
  const nachOrdner = useMemo(() => {
    const map = new Map<string, ProjectFile[]>();
    for (const o of OFFERTEN_ORDNER) map.set(o.wert, []);
    for (const f of detail.files) {
      if (f.offer_folder && map.has(f.offer_folder)) {
        map.get(f.offer_folder)!.push(f);
      }
    }
    return map;
  }, [detail.files]);

  function auswaehlen(ordner: string, files: FileList | File[] | null) {
    if (!files || !('length' in files) || !files.length) return;
    setWartend({ ordner, files: Array.from(files) });
  }

  async function hochladen(namen: string[]) {
    const auftrag = wartend;
    setWartend(null);
    if (!auftrag) return;

    const ordner = auftrag.ordner;
    setUploadIn(ordner);
    try {
      const result = await uploadFiles({
        projectId: detail.project.id,
        offerFolder: ordner,
        files: auftrag.files,
        namen,
      });
      await reload();

      if (result.errors.length) {
        reportError(new Error(result.errors.join(' · ')), 'Upload fehlgeschlagen.');
      }
      if (result.uploaded) toast(`✓ ${result.uploaded} Datei(en) eingereicht.`);
    } catch (error) {
      reportError(error, 'Upload fehlgeschlagen.');
    } finally {
      setUploadIn(null);
    }
  }

  function beiDrop(ordner: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setZiehtUeber(null);
    auswaehlen(ordner, event.dataTransfer.files);
  }

  function notizenUmschalten(fileId: string) {
    setOffeneNotizen((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  async function kommentieren(fileId: string) {
    const text = (entwuerfe[fileId] ?? '').trim();
    if (!text) return;

    try {
      await post(`/api/files/${fileId}/comments`, { text });
      setEntwuerfe((current) => ({ ...current, [fileId]: '' }));
      await reload();
    } catch (error) {
      reportError(error, 'Anmerkung konnte nicht gespeichert werden.');
    }
  }

  function kommentarLoeschen(kommentarId: string) {
    confirm('Diese Anmerkung löschen?', async () => {
      await del(`/api/files/comments/${kommentarId}`);
      await reload();
    });
  }

  function klappen(ordner: string) {
    setZu((current) => {
      const next = new Set(current);
      if (next.has(ordner)) next.delete(ordner);
      else next.add(ordner);
      return next;
    });
  }

  return (
    <div className="card">
      {wartend && (
        <UploadNamesModal
          files={wartend.files}
          titel={`Einreichen unter „${ordnerName(wartend.ordner)}“`}
          onAbbrechen={() => setWartend(null)}
          onBestaetigen={hochladen}
        />
      )}

      <div className="section-head">
        <h2>Offerten</h2>
      </div>

      <p className="offer-hinweis">
        {isAdmin
          ? 'Hier laufen alle Einreichungen zusammen. Ein Lieferant sieht nur die Unterlagen seiner eigenen Firma.'
          : session.firma
            ? `Diese Unterlagen sehen die Swiss Solar Ventures AG und deine Kolleginnen und Kollegen von ${session.firma} – andere Lieferanten nicht.`
            : 'Deine Unterlagen sieht nur die Swiss Solar Ventures AG – andere Lieferanten sehen sie nicht.'}
      </p>

      {OFFERTEN_ORDNER.map((ordner) => {
        const dateien = nachOrdner.get(ordner.wert) ?? [];
        const eingeklappt = zu.has(ordner.wert);
        const laedt = uploadIn === ordner.wert;

        return (
          <div className="offer-ordner" key={ordner.wert}>
            <button
              type="button"
              className="offer-kopf"
              onClick={() => klappen(ordner.wert)}
              aria-expanded={!eingeklappt}
            >
              <span className={`gruppe-pfeil ${eingeklappt ? 'zu' : ''}`}>▾</span>
              <span className="offer-icon" aria-hidden="true">
                {ordner.icon}
              </span>
              <span className="offer-titel">
                {ordner.name}
                <span className="offer-hinweis-klein">{ordner.hinweis}</span>
              </span>
              <span className="gruppe-anzahl">{dateien.length}</span>
            </button>

            {!eingeklappt && (
              <div className="offer-inhalt">
                <div
                  className={`offer-dropzone ${ziehtUeber === ordner.wert ? 'drag' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setZiehtUeber(ordner.wert);
                  }}
                  onDragLeave={() => setZiehtUeber(null)}
                  onDrop={(e) => beiDrop(ordner.wert, e)}
                >
                  {laedt ? (
                    <>
                      <Spinner size={22} />
                      <span>Wird hochgeladen…</span>
                    </>
                  ) : (
                    <>
                      <span>
                        Datei hierher ziehen für <strong>{ordner.name}</strong>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => inputs.current[ordner.wert]?.click()}
                        disabled={Boolean(uploadIn)}
                      >
                        📁 Datei wählen
                      </button>
                    </>
                  )}
                  <input
                    ref={(el) => {
                      inputs.current[ordner.wert] = el;
                    }}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      auswaehlen(ordner.wert, e.target.files);
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
                              {fmtSize(f.size_bytes)}{' '}
                              · {fmtDate(f.uploaded_at)}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="offer-notiz-knopf"
                            onClick={() => notizenUmschalten(f.id)}
                            title="Anmerkungen"
                          >
                            💬 {f.comments.length || ''}
                          </button>
                          {f.can_delete && (
                            <button
                              type="button"
                              className="icon-btn"
                              title="Entfernen"
                              onClick={() =>
                                confirm(`„${f.name}“ wirklich entfernen?`, async () => {
                                  await del(`/api/files/${f.id}`);
                                  await reload();
                                  toast('🗑️ Datei entfernt.');
                                })
                              }
                            >
                              ✕
                            </button>
                          )}

                          {offeneNotizen.has(f.id) && (
                            <div className="offer-notizen">
                              {f.comments.map((k) => {
                                const wer = findPerson(detail, {
                                  name: k.author,
                                  supplierId: k.author_supplier_id,
                                });
                                const meins =
                                  session.kind === 'supplier'
                                    ? k.author_supplier_id === session.supplierId
                                    : k.author_supplier_id === null;

                                return (
                                  <div className="offer-notiz" key={k.id}>
                                    <Avatar
                                      url={wer.avatarUrl}
                                      name={k.author}
                                      size={22}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div className="offer-notiz-text">{k.text}</div>
                                      <div className="offer-notiz-meta">
                                        {personLabel(wer)} · {fmtDate(k.created_at)}
                                        {(meins || isAdmin) && (
                                          <button
                                            type="button"
                                            onClick={() => kommentarLoeschen(k.id)}
                                          >
                                            entfernen
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}

                              <div className="offer-notiz-form">
                                <input
                                  type="text"
                                  value={entwuerfe[f.id] ?? ''}
                                  placeholder="Anmerkung schreiben …"
                                  onChange={(e) =>
                                    setEntwuerfe((current) => ({
                                      ...current,
                                      [f.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void kommentieren(f.id);
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn btn-accent btn-sm"
                                  onClick={() => void kommentieren(f.id)}
                                >
                                  Senden
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="offer-leer">
                    {isAdmin
                      ? 'Noch nichts eingereicht.'
                      : 'Du hast hier noch nichts eingereicht.'}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
