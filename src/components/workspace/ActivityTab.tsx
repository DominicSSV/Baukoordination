'use client';

import { useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import type { MessageDraft } from '@/components/workspace/MessageModal';
import { del, post } from '@/lib/client/api';
import { fmtDate } from '@/lib/format';
import Avatar from '@/components/Avatar';
import { findPerson } from '@/lib/people';
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

  const alleGewaehlt =
    detail.activity.length > 0 && gewaehlt.size === detail.activity.length;

  function umschalten(id: string) {
    setGewaehlt((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alleUmschalten() {
    setGewaehlt(alleGewaehlt ? new Set() : new Set(detail.activity.map((a) => a.id)));
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

      {/* Sammel-Auswahl. Die Leiste erscheint erst, wenn es etwas auszuwählen gibt. */}
      {isAdmin && detail.activity.length > 0 && (
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

      {detail.activity.length ? (
        detail.activity.map((a) => {
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
                {a.icon ?? '•'}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="activity-text">
                <strong>{a.actor_name}</strong> {a.text}
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
          <p>Noch keine Aktivität in diesem Projekt.</p>
        </div>
      )}
    </div>
  );
}
