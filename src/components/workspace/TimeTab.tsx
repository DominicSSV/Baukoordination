'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, post } from '@/lib/client/api';
import { fmtDueDate, heute } from '@/lib/due';
import { supplierLabel } from '@/lib/format';
import { nachFirmen, OHNE_FIRMA } from '@/lib/people';
import { INTERNAL_PARTY } from '@/lib/branding';
import { adminAssignee, supplierAssignee, parseAssignee } from '@/lib/assignee';
import type { ProjectDetail, Zeiteintrag } from '@/types';

/** Betrag im Schweizer Format, z.B. 12'400.50. */
function chf(wert: number): string {
  return wert.toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Stunden ohne unnötige Nullen: 8, 7.5, 7.25. */
function std(wert: number): string {
  return wert.toLocaleString('de-CH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Betrag eines Eintrags – null, solange kein Satz vereinbart ist. */
function betrag(z: Zeiteintrag): number | null {
  if (z.stundensatz === null || z.stundensatz === undefined) return null;
  return Number(z.stunden) * Number(z.stundensatz);
}

/**
 * Register "Zeiterfassung": wer wann wie lange am Projekt gearbeitet hat.
 *
 * VORERST NUR FÜR UNS. Die Lieferanten sehen das Register nicht, und die Route
 * weist sie ab – hier stehen die Stundensätze aller Firmen beieinander, und
 * was die eine verlangt, geht die andere nichts an.
 *
 * Gedacht ist es aber für sie: Später trägt jede Firma ihre eigenen Stunden
 * ein, statt sie am Monatsende aus dem Gedächtnis zu rekonstruieren. Bis dahin
 * erfassen wir sie – und die Zahlen, die dabei entstehen, bleiben gültig.
 */
export default function TimeTab({
  detail,
  reload,
}: {
  detail: ProjectDetail;
  reload: () => Promise<void>;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const projectId = detail.project.id;

  const [zeiten, setZeiten] = useState<Zeiteintrag[] | null>(null);
  const [ohneTabelle, setOhneTabelle] = useState(false);
  const [busy, setBusy] = useState(false);

  // Der Entwurf für einen neuen Eintrag. Wer und Stundensatz bleiben nach dem
  // Speichern stehen: Eine Woche derselben Firma trägt man sonst fünfmal neu ein.
  const [wer, setWer] = useState('');
  const [datum, setDatum] = useState(heute());
  const [stunden, setStunden] = useState('');
  const [satz, setSatz] = useState('');
  const [beschreibung, setBeschreibung] = useState('');

  const laden = useCallback(async () => {
    try {
      const res = await api<{ zeiten: Zeiteintrag[]; ohneTabelle?: boolean }>(
        `/api/projects/${projectId}/zeiten`,
      );
      setZeiten(res.zeiten);
      setOhneTabelle(Boolean(res.ohneTabelle));
    } catch (error) {
      reportError(error, 'Die Zeiterfassung konnte nicht geladen werden.');
      setZeiten([]);
    }
  }, [projectId, reportError]);

  // Ueber einen Timer wie in den Kontakten: Ein setState direkt im Effekt
  // loest eine Folge von Neuzeichnungen aus, die React zu Recht anmahnt.
  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  /** Wer in Frage kommt – wie überall nach Firmen gegliedert. */
  const personen = useMemo(
    () => [
      ...detail.admins.map((a) => ({
        wert: adminAssignee(a.user_id),
        name: a.name,
        gruppe: INTERNAL_PARTY,
      })),
      ...nachFirmen(detail.suppliers, (s) => s.firma).flatMap((g) =>
        g.leute.map((s) => ({
          wert: supplierAssignee(s.id),
          name: supplierLabel(s),
          gruppe: g.firma,
        })),
      ),
    ],
    [detail.admins, detail.suppliers],
  );

  const gruppen = useMemo(
    () => Array.from(new Set(personen.map((p) => p.gruppe))),
    [personen],
  );

  async function speichern() {
    const h = Number(stunden.replace(',', '.'));
    if (!wer) {
      reportError(new Error('Bitte wählen, wer gearbeitet hat.'), 'Nicht gespeichert.');
      return;
    }
    if (!Number.isFinite(h) || h <= 0 || h > 24) {
      reportError(
        new Error('Die Stunden müssen zwischen 0 und 24 liegen.'),
        'Nicht gespeichert.',
      );
      return;
    }

    const rohSatz = satz.trim().replace(',', '.');
    const s = rohSatz ? Number(rohSatz) : null;
    if (s !== null && (!Number.isFinite(s) || s < 0)) {
      reportError(new Error('Der Stundensatz ist keine gültige Zahl.'), 'Nicht gespeichert.');
      return;
    }

    const ziel = parseAssignee(wer);

    setBusy(true);
    try {
      await post(`/api/projects/${projectId}/zeiten`, {
        supplierId: ziel.kind === 'supplier' ? ziel.id : null,
        adminUserId: ziel.kind === 'admin' ? ziel.id : null,
        datum,
        stunden: h,
        stundensatz: s,
        beschreibung: beschreibung.trim() || null,
      });

      // Stunden und Text leeren, Person, Datum und Satz stehen lassen.
      setStunden('');
      setBeschreibung('');
      await laden();
      await reload();
      toast('✓ Zeit erfasst.');
    } catch (error) {
      reportError(error, 'Die Zeit konnte nicht erfasst werden.');
    } finally {
      setBusy(false);
    }
  }

  function entfernen(z: Zeiteintrag) {
    confirm(
      `${z.wer}, ${fmtDueDate(z.datum)}, ${std(Number(z.stunden))} Std. wirklich entfernen?`,
      async () => {
        setBusy(true);
        try {
          await del(`/api/zeiten/${z.id}`);
          await laden();
          toast('Eintrag entfernt.');
        } catch (error) {
          reportError(error, 'Der Eintrag konnte nicht entfernt werden.');
        } finally {
          setBusy(false);
        }
      },
      'Löschen',
    );
  }

  /**
   * Zusammengerechnet je Firma – und einmal über alles.
   *
   * Nach Firma und nicht nach Person: Abgerechnet wird mit der Firma. Wer dort
   * wie viele Stunden geleistet hat, steht unten in der Liste.
   */
  const summen = useMemo(() => {
    const liste = zeiten ?? [];
    const jeFirma = new Map<string, { firma: string; stunden: number; betrag: number; offen: boolean }>();

    for (const z of liste) {
      const name = z.firma?.trim() || z.wer;
      const eintrag = jeFirma.get(name) ?? { firma: name, stunden: 0, betrag: 0, offen: false };
      eintrag.stunden += Number(z.stunden);
      const b = betrag(z);
      if (b === null) eintrag.offen = true;
      else eintrag.betrag += b;
      jeFirma.set(name, eintrag);
    }

    const firmen = Array.from(jeFirma.values()).sort((a, b) => b.betrag - a.betrag);
    return {
      firmen,
      stunden: firmen.reduce((s, f) => s + f.stunden, 0),
      betrag: firmen.reduce((s, f) => s + f.betrag, 0),
      offen: firmen.some((f) => f.offen),
    };
  }, [zeiten]);

  if (ohneTabelle) {
    return (
      <div className="card">
        <h2>Zeiterfassung</h2>
        <p className="kontakt-erklaerung">
          Dafür fehlt noch die Datenbank-Aktualisierung <strong>0041</strong>. Sobald
          sie eingespielt ist, lässt sich hier erfassen, wer wann wie lange am
          Projekt gearbeitet hat.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Zeiterfassung</h2>
      <p className="kontakt-erklaerung">
        Wer wann wie lange an diesem Projekt gearbeitet hat, mit Stundensatz und
        Summe. <strong>Nur wir sehen dieses Register</strong> – die Lieferanten
        vorerst nicht.
      </p>

      {/* Erfassen ------------------------------------------------------- */}
      <div className="zeit-form">
        <select value={wer} onChange={(e) => setWer(e.target.value)} aria-label="Wer">
          <option value="">Wer hat gearbeitet …</option>
          {gruppen.map((g) => (
            <optgroup key={g} label={g === OHNE_FIRMA ? 'Ohne Firma' : g}>
              {personen
                .filter((p) => p.gruppe === g)
                .map((p) => (
                  <option key={p.wert} value={p.wert}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>

        <input
          type="date"
          value={datum}
          onChange={(e) => setDatum(e.target.value)}
          aria-label="Datum"
        />
        <input
          type="text"
          inputMode="decimal"
          value={stunden}
          onChange={(e) => setStunden(e.target.value)}
          placeholder="Std."
          aria-label="Stunden"
          className="zeit-zahl"
        />
        <input
          type="text"
          inputMode="decimal"
          value={satz}
          onChange={(e) => setSatz(e.target.value)}
          placeholder="CHF/Std."
          aria-label="Stundensatz"
          className="zeit-zahl"
        />
        <input
          type="text"
          value={beschreibung}
          onChange={(e) => setBeschreibung(e.target.value)}
          placeholder="Wofür? (freiwillig)"
          aria-label="Beschreibung"
        />
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => void speichern()}
          disabled={busy}
        >
          + Erfassen
        </button>
      </div>
      <p className="zeit-hinweis">
        Viertelstunden als Kommazahl: 7.25 sind sieben Stunden und eine
        Viertelstunde. Der Stundensatz darf leer bleiben, solange er nicht
        vereinbart ist – dann zählt die App nur die Stunden.
      </p>

      {/* Summen --------------------------------------------------------- */}
      {summen.firmen.length > 0 && (
        <div className="zeit-summen">
          {summen.firmen.map((f) => (
            <div className="zeit-summe" key={f.firma}>
              <div className="zeit-summe-firma">{f.firma}</div>
              <div className="zeit-summe-zahl">{std(f.stunden)} Std.</div>
              <div className="zeit-summe-betrag">
                CHF {chf(f.betrag)}
                {f.offen && <span className="zeit-offen"> + offen</span>}
              </div>
            </div>
          ))}
          <div className="zeit-summe gesamt">
            <div className="zeit-summe-firma">Gesamt</div>
            <div className="zeit-summe-zahl">{std(summen.stunden)} Std.</div>
            <div className="zeit-summe-betrag">CHF {chf(summen.betrag)}</div>
          </div>
        </div>
      )}
      {summen.offen && (
        <p className="zeit-hinweis">
          „offen“ heisst: Für diese Firma sind Stunden ohne Stundensatz erfasst.
          Sie zählen bei den Stunden mit, beim Betrag noch nicht.
        </p>
      )}

      {/* Liste ---------------------------------------------------------- */}
      {zeiten === null ? (
        <p className="kontakt-leer">Lade …</p>
      ) : zeiten.length === 0 ? (
        <p className="kontakt-leer">
          Noch nichts erfasst. Der erste Eintrag entsteht oben.
        </p>
      ) : (
        <div className="zeit-liste">
          {zeiten.map((z) => {
            const b = betrag(z);
            return (
              <div className="zeit-zeile" key={z.id}>
                <div className="zeit-datum">{fmtDueDate(z.datum)}</div>
                <div className="zeit-wer">
                  <strong>{z.wer}</strong>
                  {z.firma && z.firma !== z.wer && (
                    <span className="kontakt-firma"> · {z.firma}</span>
                  )}
                  {z.beschreibung && <div className="zeit-text">{z.beschreibung}</div>}
                  {z.erfasst_von && (
                    <div className="zeit-quelle">erfasst von {z.erfasst_von}</div>
                  )}
                </div>
                <div className="zeit-zahl-zelle">{std(Number(z.stunden))} Std.</div>
                <div className="zeit-zahl-zelle">
                  {z.stundensatz === null ? (
                    <span className="zeit-offen">kein Satz</span>
                  ) : (
                    `× ${chf(Number(z.stundensatz))}`
                  )}
                </div>
                <div className="zeit-zahl-zelle zeit-betrag">
                  {b === null ? '—' : `CHF ${chf(b)}`}
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => entfernen(z)}
                  disabled={busy}
                  title="Eintrag entfernen"
                  aria-label="Eintrag entfernen"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
