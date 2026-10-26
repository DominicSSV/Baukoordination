'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, patch, post, put } from '@/lib/client/api';
import { fmtDueDate, heute } from '@/lib/due';
import { nachFirmen, OHNE_FIRMA } from '@/lib/people';
import Spinner from '@/components/Spinner';
import type { ProjectDetail, SessionInfo, Supplier, ZeitEintrag } from '@/types';

type Antwort = {
  eintraege: ZeitEintrag[];
  saetze: Record<string, number | null>;
  meinSatz?: number | null;
  freigegeben?: string[];
  darfErfassen: boolean;
};

/** Stunden lesbar: 7.5 wird zu "7.5 h", 8 zu "8 h". */
function stundenText(wert: number): string {
  const gerundet = Math.round(wert * 100) / 100;
  return `${gerundet.toLocaleString('de-CH', { maximumFractionDigits: 2 })} h`;
}

function frankenText(wert: number): string {
  return wert.toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Zeiterfassung im Projekt.
 *
 * Wer im Stundenlohn arbeitet, trägt hier Datum und Stunden ein; die Summe
 * steht oben. Wir sehen alles, je Firma und insgesamt.
 *
 * Zwei Dinge, die den Aufbau bestimmen:
 *
 * Das Register erscheint nicht für alle. Wer pauschal offeriert hat, geht die
 * Zeiterfassung nichts an – er soll sie gar nicht erst sehen. Freigegeben
 * wird je Projekt und Firma, hier unten.
 *
 * Und jeder sieht nur seine eigenen Stunden. Was die andere Firma braucht und
 * was sie verlangt, ist deren Sache. Das stellt schon die Datenbank sicher,
 * nicht bloss diese Ansicht.
 */
export default function TimeTab({
  detail,
  session,
  isAdmin,
  reload,
}: {
  detail: ProjectDetail;
  session: SessionInfo;
  isAdmin: boolean;
  reload: () => Promise<void>;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const projectId = detail.project.id;

  const [daten, setDaten] = useState<Antwort | null>(null);
  const [busy, setBusy] = useState(false);

  // Der Entwurf für eine neue Zeile.
  const [datum, setDatum] = useState(heute());
  const [stunden, setStunden] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [satzEntwurf, setSatzEntwurf] = useState('');
  const [satzOffen, setSatzOffen] = useState(false);

  const laden = useCallback(async () => {
    try {
      const antwort = await api<Antwort>(`/api/projects/${projectId}/zeiten`);
      setDaten(antwort);
      setSatzEntwurf(
        antwort.meinSatz !== null && antwort.meinSatz !== undefined
          ? String(antwort.meinSatz)
          : '',
      );
    } catch (error) {
      reportError(error, 'Die Zeiterfassung konnte nicht geladen werden.');
      setDaten({ eintraege: [], saetze: {}, darfErfassen: false });
    }
  }, [projectId, reportError]);

  useEffect(() => {
    const start = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(start);
  }, [laden]);

  /**
   * Je Firma zusammengezählt.
   *
   * Der Betrag kommt aus dem Satz, der in der Zeile steht, und nicht aus dem
   * heutigen: Wer im März zu 95 Franken gearbeitet hat und im Juli auf 105
   * erhöht, hat im März trotzdem zu 95 gearbeitet.
   */
  const jeFirma = useMemo(() => {
    const map = new Map<
      string,
      { supplierId: string; stunden: number; betrag: number; ohneSatz: boolean }
    >();

    for (const e of daten?.eintraege ?? []) {
      const vorhanden = map.get(e.supplier_id) ?? {
        supplierId: e.supplier_id,
        stunden: 0,
        betrag: 0,
        ohneSatz: false,
      };
      vorhanden.stunden += Number(e.stunden);
      if (e.satz !== null && e.satz !== undefined) {
        vorhanden.betrag += Number(e.stunden) * Number(e.satz);
      } else {
        vorhanden.ohneSatz = true;
      }
      map.set(e.supplier_id, vorhanden);
    }

    return Array.from(map.values()).sort((a, b) => b.stunden - a.stunden);
  }, [daten?.eintraege]);

  const gesamt = useMemo(() => {
    let st = 0;
    let betrag = 0;
    let ohneSatz = false;
    for (const f of jeFirma) {
      st += f.stunden;
      betrag += f.betrag;
      if (f.ohneSatz) ohneSatz = true;
    }
    return { stunden: st, betrag, ohneSatz };
  }, [jeFirma]);

  function firmaName(id: string): string {
    const s = detail.suppliers.find((x) => x.id === id);
    if (!s) return 'Unbekannte Firma';
    return s.firma?.trim() || s.name?.trim() || 'Ohne Namen';
  }

  async function run(aktion: () => Promise<void>, fehlertext: string) {
    if (busy) return;
    setBusy(true);
    try {
      await aktion();
    } catch (error) {
      reportError(error, fehlertext);
    } finally {
      setBusy(false);
    }
  }

  function erfassen() {
    const zahl = Number(stunden.replace(',', '.'));
    if (!Number.isFinite(zahl) || zahl <= 0) {
      toast('⚠️ Bitte die Stunden angeben, z.B. 7.5', 'error');
      return;
    }

    void run(async () => {
      await post(`/api/projects/${projectId}/zeiten`, {
        datum,
        stunden: zahl,
        beschreibung: beschreibung.trim() || null,
      });
      setStunden('');
      setBeschreibung('');
      await laden();
      toast('✓ Erfasst.');
    }, 'Die Zeit konnte nicht erfasst werden.');
  }

  function zeileEntfernen(e: ZeitEintrag) {
    confirm(
      `${fmtDueDate(e.datum)}, ${stundenText(Number(e.stunden))} entfernen?`,
      async () => {
        await del(`/api/zeiten/${e.id}`);
        await laden();
        toast('🗑️ Entfernt.');
      },
    );
  }

  function satzSpeichern() {
    void run(async () => {
      await patch(`/api/projects/${projectId}/zeiten`, {
        stundensatz: satzEntwurf.trim().replace(',', '.') || null,
      });
      setSatzOffen(false);
      await laden();
      toast('✓ Ansatz gespeichert.');
    }, 'Der Ansatz konnte nicht gespeichert werden.');
  }

  /** Freigeben oder entziehen – nur für uns. */
  function freigabe(supplier: Supplier, erlaubt: boolean) {
    void run(async () => {
      await put(`/api/projects/${projectId}/zeiten`, {
        supplierId: supplier.id,
        erlaubt,
      });
      await laden();
      // Das Register erscheint beim Lieferanten erst nach dem Neuladen der
      // Projektdaten – die Freigabe hängt daran.
      await reload();
      toast(
        erlaubt
          ? `✓ ${supplier.firma || supplier.name} kann jetzt Zeit erfassen.`
          : `${supplier.firma || supplier.name} kann keine Zeit mehr erfassen.`,
      );
    }, 'Die Freigabe konnte nicht geändert werden.');
  }

  if (!daten) {
    return (
      <div className="empty-state">
        <Spinner size={48} />
        <p style={{ marginTop: 12 }}>Lade Zeiterfassung…</p>
      </div>
    );
  }

  const meineZeilen = daten.eintraege;
  const freigegeben = new Set(daten.freigegeben ?? []);
  const firmenGruppen = nachFirmen(detail.suppliers, (s) => s.firma);

  return (
    <div className="card">
      <div className="section-head">
        <h2>Zeiterfassung</h2>
      </div>

      {/* Die Summe ganz oben: Sie ist die Frage, wegen der man hier
          hereinschaut. */}
      <div className="zeit-summe">
        <div className="zeit-summe-zahl">{stundenText(gesamt.stunden)}</div>
        {gesamt.betrag > 0 && (
          <div className="zeit-summe-betrag">
            CHF {frankenText(gesamt.betrag)}
            {gesamt.ohneSatz && (
              <span className="zeit-hinweis">
                {' '}· ohne die Stunden ohne hinterlegten Ansatz
              </span>
            )}
          </div>
        )}
        <div className="zeit-summe-text">
          {meineZeilen.length} Eintrag{meineZeilen.length === 1 ? '' : 'e'}
          {isAdmin && jeFirma.length > 0 && ` · ${jeFirma.length} Firma${jeFirma.length === 1 ? '' : 'en'}`}
        </div>
      </div>

      {/* --- Erfassen: nur für die freigegebene Firma --------------------- */}
      {daten.darfErfassen && (
        <div className="zeit-neu">
          <div className="zeit-neu-felder">
            <label className="zeit-feld">
              <span>Datum</span>
              <input
                type="date"
                value={datum}
                onChange={(e) => setDatum(e.target.value)}
              />
            </label>
            <label className="zeit-feld schmal">
              <span>Stunden</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="7.5"
                value={stunden}
                onChange={(e) => setStunden(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') erfassen();
                }}
              />
            </label>
            <label className="zeit-feld breit">
              <span>Wofür (freiwillig)</span>
              <input
                type="text"
                placeholder="z.B. Montage Unterkonstruktion"
                value={beschreibung}
                onChange={(e) => setBeschreibung(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') erfassen();
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={erfassen}
              disabled={busy}
            >
              Erfassen
            </button>
          </div>

          {/* Der Ansatz ist freiwillig – deshalb klein und eingeklappt. Für
              manche genügt es, Stunden zu zählen. */}
          <div className="zeit-satz">
            {satzOffen ? (
              <>
                <span>Mein Ansatz</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="z.B. 95"
                  value={satzEntwurf}
                  onChange={(e) => setSatzEntwurf(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') satzSpeichern();
                    if (e.key === 'Escape') setSatzOffen(false);
                  }}
                  autoFocus
                />
                <span>CHF je Stunde</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={satzSpeichern}
                  disabled={busy}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSatzOffen(false)}
                >
                  Abbrechen
                </button>
              </>
            ) : (
              <button
                type="button"
                className="zeit-satz-knopf"
                onClick={() => setSatzOffen(true)}
              >
                {daten.meinSatz
                  ? `Ansatz: CHF ${frankenText(Number(daten.meinSatz))} je Stunde – ändern`
                  : 'Stundenansatz hinterlegen (freiwillig)'}
              </button>
            )}
          </div>

          {daten.meinSatz ? (
            <p className="zeit-hinweis">
              Der Ansatz wird bei jedem neuen Eintrag mitgeschrieben. Änderst du
              ihn, bleiben die bisherigen Einträge bei ihrem alten Ansatz –
              gearbeitet wurde ja zum damaligen.
            </p>
          ) : null}
        </div>
      )}

      {/* --- Je Firma, nur für uns --------------------------------------- */}
      {isAdmin && jeFirma.length > 0 && (
        <div className="zeit-firmen">
          <h4 className="zeit-titel">Nach Firma</h4>
          {jeFirma.map((f) => (
            <div className="zeit-firma" key={f.supplierId}>
              <span className="zeit-firma-name">{firmaName(f.supplierId)}</span>
              <span className="zeit-firma-stunden">{stundenText(f.stunden)}</span>
              <span className="zeit-firma-betrag">
                {f.betrag > 0 ? `CHF ${frankenText(f.betrag)}` : '–'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* --- Die Einträge ------------------------------------------------- */}
      <h4 className="zeit-titel">
        {isAdmin ? 'Alle Einträge' : 'Meine Einträge'}
      </h4>

      {meineZeilen.length ? (
        <div className="zeit-liste">
          {meineZeilen.map((e) => (
            <div className="zeit-zeile" key={e.id}>
              <span className="zeit-datum">{fmtDueDate(e.datum)}</span>
              <span className="zeit-stunden">{stundenText(Number(e.stunden))}</span>
              <span className="zeit-text">
                {isAdmin && (
                  <strong className="zeit-firma-klein">
                    {firmaName(e.supplier_id)}
                  </strong>
                )}
                {e.beschreibung || <span className="zeit-leer">–</span>}
              </span>
              <span className="zeit-betrag">
                {e.satz
                  ? `CHF ${frankenText(Number(e.stunden) * Number(e.satz))}`
                  : ''}
              </span>
              {/* Entfernen darf, wer erfasst hat. Wir sehen die Stunden,
                  berichtigen sie aber nicht: Wer sie geleistet hat, weiss als
                  Einziger, was dort richtig stünde. */}
              {!isAdmin && session.kind === 'supplier' && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => zeileEntfernen(e)}
                  title="Entfernen"
                >
                  🗑️
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state klein">
          <p>
            {daten.darfErfassen
              ? 'Noch nichts erfasst. Oben Datum und Stunden eintragen.'
              : 'Es ist noch keine Zeit erfasst.'}
          </p>
        </div>
      )}

      {/* --- Wer darf: nur für uns ---------------------------------------- */}
      {isAdmin && (
        <div className="zeit-freigabe">
          <h4 className="zeit-titel">Wer darf Zeit erfassen?</h4>
          <p className="zeit-hinweis">
            Nur die hier angekreuzten Firmen sehen das Register überhaupt. Wer
            pauschal offeriert hat, geht die Zeiterfassung nichts an.
          </p>

          {detail.suppliers.length ? (
            firmenGruppen.map((gruppe) => (
              <div className="zeit-firmengruppe" key={gruppe.firma}>
                <div className="zeit-firmengruppe-titel">
                  {gruppe.firma === OHNE_FIRMA ? 'Ohne Firma' : gruppe.firma}
                </div>
                {gruppe.leute.map((s) => (
                  <label className="zeit-haken" key={s.id}>
                    <input
                      type="checkbox"
                      checked={freigegeben.has(s.id)}
                      disabled={busy}
                      onChange={(e) => freigabe(s, e.target.checked)}
                    />
                    <span>
                      {s.name?.trim() || s.firma?.trim() || 'Ohne Namen'}
                      {daten.saetze[s.id] ? (
                        <span className="zeit-hinweis">
                          {' '}· CHF {frankenText(Number(daten.saetze[s.id]))} je Stunde
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            ))
          ) : (
            <p className="zeit-hinweis">
              Diesem Projekt ist noch keine Firma zugeteilt.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
