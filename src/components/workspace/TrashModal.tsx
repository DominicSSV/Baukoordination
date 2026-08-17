'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, post } from '@/lib/client/api';
import { fmtDate } from '@/lib/format';
import Spinner from '@/components/Spinner';
import type { PapierkorbEintrag } from '@/types';

/**
 * Papierkorb über alle Projekte: weggeworfene Aufgaben und Dateien zurückholen
 * oder endgültig entfernen.
 *
 * Nur für die Swiss Solar Ventures AG – ein Lieferant sähe hier sonst, was die
 * anderen Firmen eingereicht und wieder entfernt haben.
 */
export default function TrashModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [eintraege, setEintraege] = useState<PapierkorbEintrag[] | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      const res = await api<{ eintraege: PapierkorbEintrag[]; hinweis?: string }>(
        '/api/trash',
      );
      setEintraege(res.eintraege);
      setHinweis(res.hinweis ?? null);
    } catch (error) {
      reportError(error, 'Der Papierkorb konnte nicht geladen werden.');
      onClose();
    }
  }, [reportError, onClose]);

  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  async function wiederherstellen(e: PapierkorbEintrag) {
    setBusy(e.id);
    try {
      await post(`/api/projects/${e.projectId}/trash`, {
        art: e.art,
        id: e.id,
        aktion: 'wiederherstellen',
      });
      setEintraege((current) => (current ?? []).filter((x) => x.id !== e.id));
      await onChanged();
      toast(`♻️ „${e.text}“ wiederhergestellt.`);
    } catch (error) {
      reportError(error, 'Wiederherstellen fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  }

  function entfernen(e: PapierkorbEintrag) {
    confirm(
      `„${e.text}“ endgültig entfernen? Das lässt sich nicht rückgängig machen.`,
      async () => {
        await post(`/api/projects/${e.projectId}/trash`, {
          art: e.art,
          id: e.id,
          aktion: 'entfernen',
        });
        setEintraege((current) => (current ?? []).filter((x) => x.id !== e.id));
        toast('🗑️ Endgültig entfernt.');
      },
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 560 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <h3 style={{ fontSize: 19 }}>Papierkorb</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: 12.5 }}>
          Weggeworfene Aufgaben und Dateien aus allen Projekten. Zurückholen stellt
          sie an ihrem alten Ort wieder her.
        </p>

        {hinweis && <p className="auth-scherz">{hinweis}</p>}

        {!eintraege ? (
          <Spinner size={36} label="Lade Papierkorb…" />
        ) : eintraege.length ? (
          eintraege.map((e) => (
            <div className="korb-zeile" key={`${e.art}-${e.id}`}>
              <span className="korb-icon" aria-hidden="true">
                {e.art === 'datei' ? '📄' : '📝'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="korb-text">{e.text}</div>
                <div className="korb-meta">
                  {e.projektName} · {e.zusatz} · gelöscht {fmtDate(e.deletedAt)}
                  {e.deletedBy ? ` von ${e.deletedBy}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => wiederherstellen(e)}
                disabled={busy === e.id}
              >
                ♻️ Zurückholen
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Endgültig entfernen"
                onClick={() => entfernen(e)}
              >
                ✕
              </button>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>
            Der Papierkorb ist leer.
          </p>
        )}
      </div>
    </div>
  );
}
