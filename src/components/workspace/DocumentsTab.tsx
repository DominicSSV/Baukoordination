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
import type {
  DokumentOrdner,
  ProjectDetail,
  ProjectFile,
  SessionInfo,
} from '@/types';

/**
 * Register "Dokumente": Pläne, Schemas und Datenblätter, gegliedert nach Gewerk.
 *
 * Zwei Ebenen – ein Hauptordner darf Unterordner haben, mehr nicht. Tiefer
 * verschachtelt findet auf der Baustelle niemand mehr etwas.
 *
 * Anders als bei den Offerten sieht hier jeder alles, der Zugriff auf das
 * Projekt hat – der Elektriker muss das DC-Schema lesen können. Die Gliederung
 * verwaltet allein die Swiss Solar Ventures AG; die Sperre dafür steht in der
 * Datenbank (Migrationen 0019 und 0021) und nicht erst in dieser Ansicht.
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
  /** Entwurf für einen neuen Ordner: null = zu, sonst der Name samt Elternteil. */
  const [neu, setNeu] = useState<{ parentId: string | null; name: string } | null>(null);
  const [umbenennen, setUmbenennen] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const haupt = useMemo(
    () => detail.documentFolders.filter((o) => !o.parent_id),
    [detail.documentFolders],
  );

  const kinder = useMemo(() => {
    const map = new Map<string, DokumentOrdner[]>();
    for (const o of detail.documentFolders) {
      if (!o.parent_id) continue;
      const liste = map.get(o.parent_id) ?? [];
      liste.push(o);
      map.set(o.parent_id, liste);
    }
    return map;
  }, [detail.documentFolders]);

  /** Dokumente je Ordner, neueste zuoberst (so kommen sie aus der Abfrage). */
  const nachOrdner = useMemo(() => {
    const map = new Map<string, ProjectFile[]>();
    for (const o of detail.documentFolders) map.set(o.id, []);
    for (const f of detail.files) {
      if (f.document_folder && map.has(f.document_folder)) {
        map.get(f.document_folder)!.push(f);
      }
    }
    return map;
  }, [detail.files, detail.documentFolders]);

  /** Alle Ordner mit lesbarem Pfad, für die Auswahl beim Verschieben. */
  const ordnerPfade = useMemo(() => {
    const liste: Array<{ id: string; pfad: string }> = [];
    for (const o of haupt) {
      liste.push({ id: o.id, pfad: o.name });
      for (const k of kinder.get(o.id) ?? []) {
        liste.push({ id: k.id, pfad: `${o.name} · ${k.name}` });
      }
    }
    return liste;
  }, [haupt, kinder]);

  async function verschieben(f: ProjectFile, ordnerId: string) {
    if (ordnerId === f.document_folder) return;
    try {
      await patch(`/api/files/${f.id}`, { documentFolder: ordnerId });
      await reload();
      toast('✓ Verschoben.');
    } catch (error) {
      reportError(error, 'Verschieben fehlgeschlagen.');
    }
  }

  /** Ein zugeklappter Hauptordner verdeckt auch seine Unterordner – mitzählen. */
  function anzahlMitKindern(id: string): number {
    const eigene = nachOrdner.get(id)?.length ?? 0;
    const unten = (kinder.get(id) ?? []).reduce(
      (summe, k) => summe + (nachOrdner.get(k.id)?.length ?? 0),
      0,
    );
    return eigene + unten;
  }

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
    const entwurf = neu;
    if (!entwurf || busy) return;

    const name = entwurf.name.trim();
    if (!name) return;

    setBusy(true);
    try {
      await post(`/api/projects/${detail.project.id}/document-folders`, {
        name,
        parentId: entwurf.parentId,
      });
      setNeu(null);
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

  function ordnerLoeschen(o: DokumentOrdner) {
    // Der Server prüft dasselbe – hier steht es, damit gar nicht erst jemand
    // mit einer Fehlermeldung dasteht.
    const dokumente = nachOrdner.get(o.id)?.length ?? 0;
    const unterordner = kinder.get(o.id)?.length ?? 0;

    if (dokumente || unterordner) {
      const was = [
        dokumente ? `${dokumente} Dokument(e)` : null,
        unterordner ? `${unterordner} Unterordner` : null,
      ]
        .filter(Boolean)
        .join(' und ');
      reportError(
        new Error(`„${o.name}“ enthält noch ${was}. Bitte zuerst wegräumen.`),
        'Ordner nicht gelöscht.',
      );
      return;
    }

    confirm(`Ordner „${o.name}“ löschen?`, async () => {
      await del(`/api/projects/${detail.project.id}/document-folders`, {
        ordnerId: o.id,
      });
      await reload();
      toast('🗑️ Ordner gelöscht.');
    });
  }

  /** Eingabezeile für einen neuen Ordner oder eine Umbenennung. */
  function formular(
    wert: string,
    aendern: (text: string) => void,
    speichern: () => void,
    abbrechen: () => void,
    platzhalter: string,
    knopf: string,
  ) {
    return (
      <div className="ordner-form">
        <input
          type="text"
          value={wert}
          autoFocus
          maxLength={60}
          placeholder={platzhalter}
          onChange={(e) => aendern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') speichern();
            if (e.key === 'Escape') abbrechen();
          }}
        />
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={speichern}
          disabled={busy || !wert.trim()}
        >
          {knopf}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={abbrechen}>
          Abbrechen
        </button>
      </div>
    );
  }

  /** Die Dokumente eines Ordners samt Ablagefläche. */
  function inhalt(o: DokumentOrdner) {
    const dateien = nachOrdner.get(o.id) ?? [];
    const laedt = uploadIn === o.id;

    return (
      <>
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
                    <Avatar url={person.avatarUrl} name={f.uploaded_by} size={20} />
                    <span>
                      {eigen ? 'von dir' : personLabel(person)} ·{' '}
                      {fmtSize(f.size_bytes)} · {fmtDate(f.uploaded_at)}
                    </span>
                  </div>
                  {/* Landet etwas im falschen Ordner, muss man es nicht
                      löschen und neu hochladen. */}
                  {f.can_delete && (
                    <select
                      className="dokument-verschieben"
                      value={f.document_folder ?? ''}
                      title="In einen anderen Ordner verschieben"
                      aria-label="Ordner wechseln"
                      onChange={(e) => void verschieben(f, e.target.value)}
                    >
                      {ordnerPfade.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.pfad}
                        </option>
                      ))}
                    </select>
                  )}
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
      </>
    );
  }

  /** Ein Ordner mit Kopfzeile – für beide Ebenen dasselbe, nur eingerückt. */
  function ordnerBlock(o: DokumentOrdner, unten: boolean) {
    const eingeklappt = zu.has(o.id);
    const unterordner = kinder.get(o.id) ?? [];
    const anzahl = unten ? (nachOrdner.get(o.id)?.length ?? 0) : anzahlMitKindern(o.id);

    if (umbenennen?.id === o.id) {
      return (
        <div className={unten ? 'ordner-unter' : ''} key={o.id}>
          {formular(
            umbenennen.name,
            (name) => setUmbenennen({ id: o.id, name }),
            umbenennenSpeichern,
            () => setUmbenennen(null),
            'Neuer Name',
            'Speichern',
          )}
        </div>
      );
    }

    return (
      <div className={`offer-ordner ${unten ? 'ordner-unter' : ''}`} key={o.id}>
        <div className="ordner-kopf-zeile">
          <button
            type="button"
            className="offer-kopf"
            onClick={() => klappen(o.id)}
            aria-expanded={!eingeklappt}
          >
            <span className={`gruppe-pfeil ${eingeklappt ? 'zu' : ''}`}>▾</span>
            <span className="offer-icon" aria-hidden="true">
              {unten ? '📁' : '🗂️'}
            </span>
            <span className="offer-titel">{o.name}</span>
            <span className="gruppe-anzahl">{anzahl}</span>
          </button>

          {isAdmin && (
            <>
              {!unten && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Unterordner anlegen"
                  onClick={() => {
                    setNeu({ parentId: o.id, name: '' });
                    setZu((current) => {
                      const next = new Set(current);
                      next.delete(o.id);
                      return next;
                    });
                  }}
                >
                  ＋
                </button>
              )}
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
                  anzahl || unterordner.length
                    ? 'Erst leeren – der Ordner ist nicht leer'
                    : 'Ordner löschen'
                }
                onClick={() => ordnerLoeschen(o)}
              >
                ✕
              </button>
            </>
          )}
        </div>

        {!eingeklappt && (
          <div className="offer-inhalt">
            {inhalt(o)}

            {neu?.parentId === o.id &&
              formular(
                neu.name,
                (name) => setNeu({ parentId: o.id, name }),
                anlegen,
                () => setNeu(null),
                `Unterordner in „${o.name}“`,
                'Anlegen',
              )}

            {unterordner.map((k) => ordnerBlock(k, true))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      {wartend && (
        <UploadNamesModal
          files={wartend.files}
          titel={`Ablegen unter „${
            detail.documentFolders.find((o) => o.id === wartend.ordner)?.name ??
            'Dokumente'
          }“`}
          onAbbrechen={() => setWartend(null)}
          onBestaetigen={hochladen}
        />
      )}

      <div className="section-head">
        <h2>Dokumente</h2>
        {isAdmin && neu === null && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setNeu({ parentId: null, name: '' })}
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

      {isAdmin &&
        neu?.parentId === null &&
        formular(
          neu.name,
          (name) => setNeu({ parentId: null, name }),
          anlegen,
          () => setNeu(null),
          'Name des Ordners, z.B. Wärmepumpe',
          'Anlegen',
        )}

      {!haupt.length && (
        <p className="offer-hinweis">
          Es sind noch keine Ordner da. Sie kommen mit den Datenbank-Aktualisierungen
          0019 und 0021 – oder du legst dir eigene an.
        </p>
      )}

      {haupt.map((o) => ordnerBlock(o, false))}
    </div>
  );
}
