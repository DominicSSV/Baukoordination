'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, patch, post } from '@/lib/client/api';
import { fmtDate } from '@/lib/format';
import AssigneePicker from '@/components/workspace/AssigneePicker';
import Spinner from '@/components/Spinner';
import type { AufgabeZumBearbeiten } from '@/app/api/todos/[id]/bearbeiten/route';
import type { AdminProfile, Supplier, TodoComment } from '@/types';

type Daten = {
  aufgabe: AufgabeZumBearbeiten;
  admins: AdminProfile[];
  suppliers: Supplier[];
  comments: TodoComment[];
  darfBearbeiten: boolean;
};

/**
 * Eine Aufgabe direkt in der Übersicht ändern – Frist, Zuständige, Text,
 * Kommentare.
 *
 * Bis hierher führte jede Änderung über das Projekt: aufklappen, Register
 * suchen, Aufgabe wiederfinden, ändern, zurück. Bei einer Frist, die um einen
 * Tag verschoben wird, ist das mehr Weg als Arbeit – und in der Übersicht
 * steht die Aufgabe ja bereits vor der Nase.
 *
 * Geladen wird erst beim Aufklappen und nur für diese eine Zeile. Die
 * Übersicht zeigt Aufgaben aus allen Projekten; die Zuständigen und die
 * Kommentare für alle im Voraus zu holen hiesse, für zwei Handgriffe
 * dreihundert Aufgaben mitzuschleppen.
 */
export default function WocheBearbeiten({
  todoId,
  onGespeichert,
  onGeloescht,
  onSchliessen,
}: {
  todoId: string;
  onGespeichert: (aenderung: {
    text: string;
    dueDate: string | null;
    assignees: string[];
  }) => void;
  onGeloescht: () => void;
  onSchliessen: () => void;
}) {
  const { confirm, reportError, toast } = useFeedback();

  const [daten, setDaten] = useState<Daten | null>(null);
  const [text, setText] = useState('');
  const [frist, setFrist] = useState('');
  const [zustaendig, setZustaendig] = useState<string[]>([]);
  const [kommentar, setKommentar] = useState('');
  const [speichert, setSpeichert] = useState(false);

  const laden = useCallback(async () => {
    try {
      const antwort = await api<Daten>(`/api/todos/${todoId}/bearbeiten`);
      setDaten(antwort);
      setText(antwort.aufgabe.text);
      setFrist(antwort.aufgabe.dueDate ?? '');
      setZustaendig(antwort.aufgabe.assignees);
    } catch (error) {
      reportError(error, 'Die Aufgabe konnte nicht geladen werden.');
      onSchliessen();
    }
  }, [todoId, reportError, onSchliessen]);

  useEffect(() => {
    const start = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(start);
  }, [laden]);

  async function speichern() {
    if (!daten || speichert) return;
    const sauber = text.trim();
    if (!sauber) {
      toast('⚠️ Ohne Text geht es nicht.', 'error');
      return;
    }

    setSpeichert(true);
    try {
      await patch(`/api/todos/${todoId}`, {
        text: sauber,
        dueDate: frist || null,
        assignees: zustaendig,
      });
      onGespeichert({ text: sauber, dueDate: frist || null, assignees: zustaendig });
      toast('✓ Gespeichert.');
      onSchliessen();
    } catch (error) {
      reportError(error, 'Die Änderung konnte nicht gespeichert werden.');
    } finally {
      setSpeichert(false);
    }
  }

  /**
   * Kommentieren geht auch für den, der die Aufgabe nicht ändern darf.
   *
   * Eine Rückfrage ist keine Änderung – und sie ist der häufigste Weg, wie auf
   * der Baustelle etwas zurückkommt.
   */
  async function kommentieren() {
    const sauber = kommentar.trim();
    if (!sauber || !daten) return;

    setKommentar('');
    try {
      const { comment } = await post<{ comment: TodoComment }>(
        `/api/todos/${todoId}/comments`,
        { text: sauber },
      );
      // kudos bleibt leer: Die Schnittstelle liefert das Feld beim Anlegen
      // nicht mit, und ohne es stünde dort undefined.
      setDaten({ ...daten, comments: [...daten.comments, { ...comment, kudos: [] }] });
    } catch (error) {
      setKommentar(sauber);
      reportError(error, 'Der Kommentar konnte nicht gespeichert werden.');
    }
  }

  function loeschen() {
    confirm(
      'Diese Aufgabe in den Papierkorb legen? Sie lässt sich dort wieder '
        + 'hervorholen.',
      async () => {
        await del(`/api/todos/${todoId}`);
        toast('🗑️ In den Papierkorb gelegt.');
        onGeloescht();
      },
      'Ja, weglegen',
    );
  }

  if (!daten) {
    return (
      <div className="woche-bearbeiten laedt">
        <Spinner size={22} />
        <span>Lade…</span>
      </div>
    );
  }

  const nurLesen = !daten.darfBearbeiten;

  return (
    <div className="woche-bearbeiten">
      {nurLesen ? (
        <p className="woche-nurlesen">
          Diese Aufgabe hat jemand anderes angelegt – ändern lässt sie sich nur
          dort. Abhaken und kommentieren geht hier.
        </p>
      ) : (
        <>
          <label className="woche-feldname" htmlFor={`text-${todoId}`}>
            Aufgabe
          </label>
          <input
            id={`text-${todoId}`}
            type="text"
            className="woche-feld"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void speichern();
              if (e.key === 'Escape') onSchliessen();
            }}
          />

          <label className="woche-feldname" htmlFor={`frist-${todoId}`}>
            Zu erledigen bis
          </label>
          <div className="woche-fristreihe">
            <input
              id={`frist-${todoId}`}
              type="date"
              className="woche-feld"
              value={frist}
              onChange={(e) => setFrist(e.target.value)}
            />
            {frist && (
              <button
                type="button"
                className="woche-kleinknopf"
                onClick={() => setFrist('')}
                title="Frist entfernen"
              >
                ohne Frist
              </button>
            )}
          </div>

          <label className="woche-feldname">Zuständig</label>
          <AssigneePicker
            value={zustaendig}
            onChange={setZustaendig}
            admins={daten.admins}
            suppliers={daten.suppliers}
            erlaubtIntern={!daten.admins.length}
          />

          <div className="woche-knopfreihe">
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => void speichern()}
              disabled={speichert}
            >
              {speichert ? 'Wird gespeichert…' : 'Speichern'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSchliessen}>
              Abbrechen
            </button>
            <button
              type="button"
              className="woche-loeschen"
              onClick={loeschen}
              title="In den Papierkorb legen"
            >
              🗑️
            </button>
          </div>
        </>
      )}

      {/* Kommentare ---------------------------------------------------- */}
      <div className="woche-kommentare">
        <div className="woche-feldname">
          {daten.comments.length
            ? `${daten.comments.length} Kommentar${daten.comments.length === 1 ? '' : 'e'}`
            : 'Kommentare'}
        </div>

        {daten.comments.map((c) => (
          <div className="woche-kommentar" key={c.id}>
            <div className="woche-kommentar-kopf">
              <strong>{c.author}</strong>
              <span>{fmtDate(c.created_at)}</span>
            </div>
            <div className="woche-kommentar-text">{c.text}</div>
          </div>
        ))}

        <div className="woche-kommentar-neu">
          <input
            type="text"
            className="woche-feld"
            value={kommentar}
            placeholder="Kommentar hinzufügen…"
            onChange={(e) => setKommentar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void kommentieren();
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void kommentieren()}
            disabled={!kommentar.trim()}
          >
            Senden
          </button>
        </div>
      </div>
    </div>
  );
}
