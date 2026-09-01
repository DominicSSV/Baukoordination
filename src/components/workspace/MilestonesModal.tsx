'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, post } from '@/lib/client/api';
import Spinner from '@/components/Spinner';
import type { MeilensteinVorlage, Project } from '@/types';

/**
 * Meilensteine: die feste Schrittfolge eines Projekts, gespeichert und
 * wiederverwendbar.
 *
 * Übernommen wird nur der Text. Frist und Zuständige gehören zum einzelnen
 * Bau – eine Vorlage mit dem Datum von Berg wäre bei Dietikon von Anfang an
 * falsch.
 */
export default function MilestonesModal({
  project,
  onClose,
  onUebernommen,
}: {
  project: Project;
  onClose: () => void;
  onUebernommen: () => Promise<void>;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [vorlagen, setVorlagen] = useState<MeilensteinVorlage[] | null>(null);
  const [ohneTabelle, setOhneTabelle] = useState(false);
  const [neuerName, setNeuerName] = useState(`Ablauf ${project.name}`);
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    try {
      const res = await api<{ vorlagen: MeilensteinVorlage[]; ohneTabelle?: boolean }>(
        '/api/milestone-templates',
      );
      setVorlagen(res.vorlagen);
      setOhneTabelle(Boolean(res.ohneTabelle));
    } catch (error) {
      reportError(error, 'Die Vorlagen konnten nicht geladen werden.');
      setVorlagen([]);
    }
  }, [reportError]);

  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  async function speichern() {
    if (busy || !neuerName.trim()) return;
    setBusy(true);
    try {
      const { vorlage } = await post<{ vorlage: MeilensteinVorlage }>(
        '/api/milestone-templates',
        { name: neuerName.trim(), projectId: project.id },
      );
      await laden();
      toast(`✓ „${vorlage.name}“ gespeichert – ${vorlage.schritte.length} Schritte.`);
    } catch (error) {
      reportError(error, 'Vorlage konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }

  async function uebernehmen(v: MeilensteinVorlage, alle: boolean) {
    setBusy(true);
    try {
      const res = await post<{ projekte: number; neu: number }>(
        `/api/milestone-templates/${v.id}/apply`,
        alle ? { alle: true } : { projectId: project.id },
      );

      await onUebernommen();
      toast(
        res.neu
          ? `✓ ${res.neu} Meilensteine angelegt${alle ? ` in ${res.projekte} Projekten` : ''}.`
          : 'Alles war schon vorhanden – nichts doppelt angelegt.',
      );
    } catch (error) {
      reportError(error, 'Übernahme fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  function loeschen(v: MeilensteinVorlage) {
    confirm(
      `Vorlage „${v.name}“ löschen? Die bereits angelegten Meilensteine in den Projekten bleiben.`,
      async () => {
        await del(`/api/milestone-templates/${v.id}/apply`);
        await laden();
        toast('🗑️ Vorlage gelöscht.');
      },
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal vorlagen-modal">
        <div className="kontakt-kopf">
          <h3 style={{ fontSize: 19, margin: 0 }}>Meilensteine</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="kontakt-erklaerung" style={{ marginTop: 0 }}>
          Die festen Schritte, die bei jeder Anlage vorkommen. Übernommen wird nur
          der Text – Frist und Zuständige setzt du danach im Projekt. Schritte, die
          schon da sind, werden übersprungen; du kannst also jederzeit erneut
          übernehmen, wenn eine Vorlage gewachsen ist.
        </p>

        {ohneTabelle && (
          <p className="speicher-hinweis">
            Vorlagen gibt es erst nach der Datenbank-Aktualisierung 0030.
          </p>
        )}

        {!vorlagen ? (
          <Spinner size={36} label="Lade Vorlagen…" />
        ) : (
          <>
            {vorlagen.map((v) => (
              <div className="vorlage" key={v.id}>
                <div className="vorlage-kopf">
                  <div style={{ minWidth: 0 }}>
                    <div className="vorlage-name">{v.name}</div>
                    <div className="vorlage-zweck">
                      {v.schritte.length} Schritte · {v.schritte.join(' · ')}
                    </div>
                  </div>
                  <div className="kontakt-knoepfe">
                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      onClick={() => void uebernehmen(v, false)}
                      disabled={busy}
                    >
                      In „{project.name}“
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void uebernehmen(v, true)}
                      disabled={busy}
                      title="Bei allen Projekten anlegen, was dort noch fehlt"
                    >
                      In alle Projekte
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => loeschen(v)}
                      disabled={busy}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!vorlagen.length && !ohneTabelle && (
              <p className="leer-hinweis">Noch keine Vorlage gespeichert.</p>
            )}
          </>
        )}

        <div className="vorlage">
          <div className="vorlage-name">Aus diesem Projekt eine Vorlage machen</div>
          <div className="vorlage-zweck">
            Genommen werden die Aufgaben von „{project.name}“ in ihrer Reihenfolge.
            Sind dort schon Meilensteine markiert, nur diese – sonst alle Aufgaben.
          </div>
          <div className="mail-test" style={{ marginTop: 8 }}>
            <input
              type="text"
              value={neuerName}
              onChange={(e) => setNeuerName(e.target.value)}
              placeholder="Name der Vorlage"
              aria-label="Name der Vorlage"
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void speichern()}
              disabled={busy || !neuerName.trim()}
            >
              {busy ? 'Einen Moment…' : '🏁 Speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
