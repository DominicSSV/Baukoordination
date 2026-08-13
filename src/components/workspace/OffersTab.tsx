'use client';

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtSize, fmtDate } from '@/lib/format';
import Spinner from '@/components/Spinner';
import Avatar from '@/components/Avatar';
import { findPerson } from '@/lib/people';
import { OFFERTEN_ORDNER } from '@/lib/offers';
import type { ProjectDetail, ProjectFile, SessionInfo } from '@/types';

/**
 * Register "Offerten": vier feste Ordner, in die Lieferanten ihre Unterlagen
 * legen. Ein Lieferant sieht ausschliesslich die eigenen Einreichungen – dafür
 * sorgt die Datenbank (Migration 0012), nicht erst diese Ansicht.
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

  async function hochladen(ordner: string, files: FileList | File[] | null) {
    if (!files || !('length' in files) || !files.length) return;

    setUploadIn(ordner);
    try {
      const result = await uploadFiles({
        projectId: detail.project.id,
        offerFolder: ordner,
        files,
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
    void hochladen(ordner, event.dataTransfer.files);
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
      <div className="section-head">
        <h2>Offerten</h2>
      </div>

      <p className="offer-hinweis">
        {isAdmin
          ? 'Hier laufen alle Einreichungen der Lieferanten zusammen. Jeder Lieferant sieht ausschliesslich seine eigenen Unterlagen.'
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
                      void hochladen(ordner.wert, e.target.files);
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
                              {eigen ? 'von dir' : f.uploaded_by} · {fmtSize(f.size_bytes)}{' '}
                              · {fmtDate(f.uploaded_at)}
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
                                  toast('🗑️ Datei entfernt.');
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
