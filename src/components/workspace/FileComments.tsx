'use client';

import { useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, post } from '@/lib/client/api';
import { fmtDate } from '@/lib/format';
import { findPerson, personLabel } from '@/lib/people';
import Avatar from '@/components/Avatar';
import DaumenKnopf from '@/components/workspace/DaumenKnopf';
import type { ProjectDetail, ProjectFile, SessionInfo } from '@/types';

/**
 * Anmerkungen zu einer Datei – zu einem Foto ebenso wie zu einem Plan.
 *
 * Bisher gab es das nur bei den Offerten, dort fest eingebaut. Auf der
 * Baustelle betrifft es aber gerade die Fotos: "Das ist die Stelle mit dem
 * Riss", "Kabel liegt hier falsch". Ohne Anmerkung geht so etwas über WhatsApp
 * an eine einzelne Person und ist eine Woche später nicht mehr auffindbar –
 * das Foto liegt hier, die Erklärung dazu irgendwo anders.
 *
 * Deshalb eine eigene Komponente statt dreimal derselbe Block: Eine Anmerkung
 * soll überall gleich aussehen und gleich funktionieren.
 */
export default function FileComments({
  datei,
  detail,
  session,
  isAdmin,
  reload,
}: {
  datei: ProjectFile;
  detail: ProjectDetail;
  session: SessionInfo;
  isAdmin: boolean;
  reload: () => Promise<void>;
}) {
  const { reportError, confirm } = useFeedback();
  const [entwurf, setEntwurf] = useState('');
  const [busy, setBusy] = useState(false);

  async function senden() {
    const text = entwurf.trim();
    if (!text || busy) return;

    setBusy(true);
    try {
      await post(`/api/files/${datei.id}/comments`, { text });
      setEntwurf('');
      await reload();
    } catch (error) {
      reportError(error, 'Anmerkung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }

  function loeschen(kommentarId: string) {
    confirm('Diese Anmerkung löschen?', async () => {
      await del(`/api/files/comments/${kommentarId}`);
      await reload();
    });
  }

  return (
    <div className="offer-notizen">
      {datei.comments.map((k) => {
        const wer = findPerson(detail, {
          name: k.author,
          supplierId: k.author_supplier_id,
        });

        // Die eigene Anmerkung darf man selbst wegnehmen; alles andere nur wir.
        const meins =
          session.kind === 'supplier'
            ? k.author_supplier_id === session.supplierId
            : k.author_supplier_id === null;

        return (
          <div className="offer-notiz" key={k.id}>
            <Avatar url={wer.avatarUrl} name={k.author} size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="offer-notiz-text">{k.text}</div>
              <div className="offer-notiz-meta">
                {personLabel(wer)} · {fmtDate(k.created_at)}
                <DaumenKnopf
                  commentId={k.id}
                  art="datei"
                  kudos={k.kudos}
                  session={session}
                  reload={reload}
                />
                {(meins || isAdmin) && (
                  <button type="button" onClick={() => loeschen(k.id)}>
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
          value={entwurf}
          placeholder="Anmerkung schreiben …"
          onChange={(e) => setEntwurf(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void senden();
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={() => void senden()}
          disabled={busy || !entwurf.trim()}
        >
          Senden
        </button>
      </div>
    </div>
  );
}
