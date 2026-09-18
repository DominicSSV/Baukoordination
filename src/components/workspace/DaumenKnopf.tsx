'use client';

import { useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { post } from '@/lib/client/api';
import type { Daumen, SessionInfo } from '@/types';

/**
 * "Gesehen, einverstanden" mit einem Klick.
 *
 * Auf der Baustelle braucht es oft keine Antwort, sondern nur ein Zeichen. Wer
 * dafür "ok" tippen muss, tippt es nicht – und der Fragende wartet weiter.
 *
 * Ein zweiter Klick nimmt den Daumen zurück. Ohne das bliebe ein versehentlich
 * gesetzter für immer stehen.
 */
export default function DaumenKnopf({
  commentId,
  art,
  kudos,
  session,
  reload,
}: {
  commentId: string;
  art: 'todo' | 'datei';
  kudos: Daumen[];
  session: SessionInfo;
  reload: () => Promise<void>;
}) {
  const { reportError } = useFeedback();
  const [busy, setBusy] = useState(false);

  const ich =
    session.kind === 'admin' ? `admin:${session.userId}` : `supplier:${session.supplierId}`;

  const liste = kudos ?? [];
  const meiner = liste.some((k) => k.wer === ich);

  async function umschalten() {
    if (busy) return;
    setBusy(true);
    try {
      await post(`/api/comments/${commentId}/kudos`, { art });
      await reload();
    } catch (error) {
      reportError(error, 'Der Daumen konnte nicht gesetzt werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`daumen ${meiner ? 'meiner' : ''}`}
      onClick={() => void umschalten()}
      disabled={busy}
      // Wer schon zugestimmt hat, steht im Titel – auf der Baustelle zählt,
      // von wem das Zeichen kommt, nicht wie viele es waren.
      title={
        liste.length
          ? `${liste.map((k) => k.name).join(', ')}${meiner ? ' – nochmal klicken, um zurückzunehmen' : ''}`
          : 'Gesehen und einverstanden'
      }
      aria-pressed={meiner}
    >
      👍{liste.length > 0 && <span className="daumen-zahl">{liste.length}</span>}
    </button>
  );
}
