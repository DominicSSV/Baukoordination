'use client';

import { useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import type { MessageDraft } from '@/components/workspace/MessageModal';
import { del, post } from '@/lib/client/api';
import { fmtDate } from '@/lib/format';
import Avatar from '@/components/Avatar';
import { findPerson, personLabel } from '@/lib/people';
import type { ProjectDetail } from '@/types';

type NotifyResponse = {
  sent: boolean;
  reason?: string;
  recipientCount?: number;
  email: string;
  subject: string;
  body: string;
};

export default function ActivityTab({
  detail,
  isAdmin,
  reload,
  onMessage,
}: {
  detail: ProjectDetail;
  isAdmin: boolean;
  reload: () => Promise<void>;
  onMessage: (draft: MessageDraft) => void;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [suche, setSuche] = useState('');
  const [wer, setWer] = useState('');

  /** Wer im Protokoll vorkommt – für die Auswahl, ohne doppelte Namen. */
  const beteiligte = useMemo(
    () => Array.from(new Set(detail.activity.map((a) => a.actor_name))).sort(),
    [detail.activity],
  );

  const eintraege = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return detail.activity.filter(
      (a) =>
        (!wer || a.actor_name === wer) &&
        (!begriff || a.text.toLowerCase().includes(begriff)),
    );
  }, [detail.activity, suche, wer]);

  // Auswählen und Löschen beziehen sich auf das, was gerade zu sehen ist –
  // sonst löschte "Alle auswählen" auch Verstecktes mit.
  const alleGewaehlt = eintraege.length > 0 && gewaehlt.size === eintraege.length;

  function umschalten(id: string) {
    setGewaehlt((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alleUmschalten() {
    setGewaehlt(alleGewaehlt ? new Set() : new Set(eintraege.map((a) => a.id)));
  }

  /** Nur die Swiss Solar Ventures AG darf Einträge aus dem Protokoll entfernen. */
  function removeEntry(id: string) {
    confirm('Diesen Eintrag aus der Aktivität löschen?', async () => {
      await del(`/api/activity/${id}`);
      setGewaehlt((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      await reload();
      toast('🗑️ Eintrag gelöscht.');
    });
  }

  function removeSelected() {
    const ids = Array.from(gewaehlt);
    if (!ids.length) return;

    confirm(
      ids.length === 1
        ? 'Diesen Eintrag aus der Aktivität löschen?'
        : `${ids.length} Einträge aus der Aktivität löschen?`,
      async () => {
        const { deleted } = await post<{ deleted: number }>('/api/activity/delete', {
          ids,
        });
        setGewaehlt(new Set());
        await reload();
        toast(`🗑️ ${deleted} Eintrag${deleted === 1 ? '' : 'e'} gelöscht.`);
      },
    );
  }

  async function sendUpdate() {
    setBusy(true);
    try {
      const result = await post<NotifyResponse>(
        `/api/projects/${detail.project.id}/notify`,
      );

      if (result.sent) {
        toast(
          `✉️ Update an ${result.recipientCount ?? 0} Empfänger verschickt.`,
        );
        return;
      }

      // Konnte nicht automatisch verschickt werden: Text zum Kopieren anbieten.
      onMessage({
        title: 'Update versenden',
        reason: result.reason,
        email: result.email,
        subject: result.subject,
        body: result.body,
      });
    } catch (error) {
      reportError(error, 'Update konnte nicht verschickt werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="section-head">
        <h2>Aktivität</h2>
        {isAdmin && (
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={sendUpdate}
            disabled={busy}
          >
            {busy ? 'Wird versendet…' : '📧 Update senden'}
          </button>
        )}
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '-6px 0 14px' }}>
        Automatisch protokolliert: erledigte Aufgaben, Kommentare und hochgeladene Dateien.
      </p>

      {detail.activity.length > 6 && (
        <div className="filter-leiste">
          <input
            type="text"
            className="filter-feld"
            value={suche}
            placeholder="Im Protokoll suchen…"
            onChange={(e) => setSuche(e.target.value)}
          />
          <select value={wer} onChange={(e) => setWer(e.target.value)}>
            <option value="">Alle Personen</option>
            {beteiligte.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {(suche || wer) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSuche('');
                setWer('');
              }}
            >
              Zurücksetzen
            </button>
          )}
          <span className="filter-anzahl">
            {eintraege.length} von {detail.activity.length}
          </span>
        </div>
      )}

      {/* Sammel-Auswahl. Die Leiste erscheint erst, wenn es etwas auszuwählen gibt. */}
      {isAdmin && eintraege.length > 0 && (
        <div className="bulk-bar">
          <label className="bulk-check">
            <input type="checkbox" checked={alleGewaehlt} onChange={alleUmschalten} />
            Alle auswählen
          </label>

          {gewaehlt.size > 0 && (
            <>
              <span className="bulk-count">
                {gewaehlt.size} ausgewählt
              </span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={removeSelected}
              >
                🗑️ Löschen
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setGewaehlt(new Set())}
              >
                Auswahl aufheben
              </button>
            </>
          )}
        </div>
      )}

      {eintraege.length ? (
        eintraege.map((a) => {
          const person = findPerson(detail, { name: a.actor_name });

          return (
          <div
            key={a.id}
            className={`activity-row ${gewaehlt.has(a.id) ? 'selected' : ''}`}
          >
            {isAdmin && (
              <input
                type="checkbox"
                className="activity-check"
                checked={gewaehlt.has(a.id)}
                onChange={() => umschalten(a.id)}
                aria-label="Eintrag auswählen"
              />
            )}
            {/* Bild der Person, das Symbol daneben sagt, worum es ging. */}
            <div className="activity-person">
              <Avatar url={person.avatarUrl} name={person.name} size={30} />
              <span className="activity-badge" aria-hidden="true">
                {/* Ältere Offerten-Einträge tragen noch ein anderes Symbol. */}
                {(a.icon === '💰' ? '📑' : a.icon) ?? '•'}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="activity-text">
                <strong>{personLabel(person)}</strong> {a.text}
              </div>
              <div className="activity-meta">{fmtDate(a.created_at)}</div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="icon-btn"
                title="Eintrag löschen"
                onClick={() => removeEntry(a.id)}
              >
                ✕
              </button>
            )}
          </div>
          );
        })
      ) : (
        <div className="empty-state" style={{ padding: '36px 10px' }}>
          <p>
            {detail.activity.length
              ? 'Kein Eintrag passt zu diesem Filter.'
              : 'Noch keine Aktivität in diesem Projekt.'}
          </p>
        </div>
      )}
    </div>
  );
}
