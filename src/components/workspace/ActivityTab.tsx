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

  /** Nur die Swiss Solar Ventures AG darf Einträge aus dem Protokoll entfernen. */
  function removeEntry(id: string) {
    confirm('Diesen Eintrag aus der Aktivität löschen?', async () => {
      await del(`/api/activity/${id}`);
      await reload();
      toast('🗑️ Eintrag gelöscht.');
    });
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

      {detail.activity.length ? (
        detail.activity.map((a) => {
          const person = findPerson(detail, { name: a.actor_name });

          return (
          <div key={a.id} className="activity-row">
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
