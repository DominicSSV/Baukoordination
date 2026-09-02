'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, patch, post } from '@/lib/client/api';
import Spinner from '@/components/Spinner';
import WhatsAppButton from '@/components/workspace/WhatsAppButton';
import { waNummer } from '@/lib/whatsapp';
import { removeProjektBild, uploadProjektBild } from '@/lib/client/bildUpload';
import { WOCHENTAGE, istHeuteVorOrt, tageText } from '@/lib/tage';
import type { ProjectDetail, ProjektInfo, ProjektKontakt } from '@/types';

type Entwurf = {
  rolle: string;
  name: string;
  firma: string;
  telefon: string;
  email: string;
  notiz: string;
  /** Wochentage 1–7. Leer = immer vor Ort, siehe lib/tage.ts. */
  tage: number[];
};

const LEER: Entwurf = {
  rolle: '',
  name: '',
  firma: '',
  telefon: '',
  email: '',
  notiz: '',
  tage: [],
};

/**
 * Vorschläge für das Feld "Funktion".
 *
 * Bewusst nur Vorschläge und keine feste Auswahl: Auf der nächsten Baustelle
 * heisst es "Werkleitung" oder "Bewirtschafterin", und eine geschlossene Liste
 * würde dann zwingen, etwas Falsches auszuwählen.
 */
const ROLLEN = [
  'Hauswart',
  'Kontakt vor Ort',
  'Bauherr',
  'Verwaltung',
  'Architekt',
  'Elektriker',
  'Bauleitung',
  'Netzbetreiber',
];

/**
 * Vorschläge für die Angaben zum Objekt – dieselbe Überlegung wie bei den
 * Funktionen: nur Vorschläge, keine feste Auswahl.
 */
const INFO_TITEL = [
  'Standort',
  'Leistung kWp',
  'Wechselrichter-Modell',
  'Module',
  'Zugang',
  'Abrechnungsmodell',
  'Parkieren',
  'Netzbetreiber',
  'Besonderes',
];

/**
 * Womit ein leeres Projekt anfängt.
 *
 * Diese fünf braucht ihr bei jeder Anlage. Sie leer anzulegen ist besser, als
 * sie zu vergessen: Eine sichtbare Zeile "kWp: —" fragt danach, eine fehlende
 * Zeile nicht.
 */
const STANDARD_ANGABEN = [
  'Standort',
  'Leistung kWp',
  'Wechselrichter-Modell',
  'Zugang',
  'Abrechnungsmodell',
];

/**
 * Register "Infos" eines Projekts: alles, was man wissen muss, bevor man
 * hinfährt. Oben die Angaben zum Objekt – Zugang, Standort, Parkieren –,
 * darunter die Leute am Bau, die nicht in der App sind.
 *
 * Sehen dürfen beides alle Beteiligten: Wer vor verschlossener Tür steht,
 * braucht den Code oder die Nummer des Hauswarts sofort und nicht auf
 * Rückfrage. Pflegen darf sie nur die Swiss Solar Ventures AG.
 */
export default function ProjectInfoTab({
  detail,
  isAdmin,
  reload,
}: {
  detail: ProjectDetail;
  isAdmin: boolean;
  reload: () => Promise<void>;
}) {
  const projectId = detail.project.id;

  /**
   * Wer für dieses Projekt freigegeben ist – aus dem, was die App ohnehin weiss.
   *
   * Bewusst keine eigene Liste in der Datenbank: Das wären zwei Wahrheiten, und
   * die zweite wäre nach der ersten Änderung der Freigaben falsch.
   */
  const beteiligte = detail.suppliers.filter((l) => detail.accessIds.includes(l.id));
  const { toast, reportError, confirm } = useFeedback();
  const [infos, setInfos] = useState<ProjektInfo[] | null>(null);
  const [kontakte, setKontakte] = useState<ProjektKontakt[] | null>(null);
  const [ohneTabelle, setOhneTabelle] = useState(false);
  /** true = Migration 0032 fehlt, die Tage vor Ort lassen sich nicht speichern. */
  const [ohneTage, setOhneTage] = useState(false);
  const [neueInfo, setNeueInfo] = useState<{ titel: string; text: string } | null>(null);
  const [infoBearbeitet, setInfoBearbeitet] = useState<string | null>(null);
  const [infoEntwurf, setInfoEntwurf] = useState({ titel: '', text: '' });
  const [neu, setNeu] = useState<Entwurf | null>(null);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf>(LEER);
  const [busy, setBusy] = useState(false);
  const [bildLaeuft, setBildLaeuft] = useState(false);
  const bildWahl = useRef<HTMLInputElement>(null);

  const bildUrl = detail.project.bild_url ?? null;

  /**
   * Bild der Liegenschaft setzen oder austauschen.
   *
   * Darf jeder mit Zugriff auf das Projekt – dieselbe Regel wie bei den übrigen
   * Angaben. Wer vor Ort steht, hat das Foto ohnehin schon auf dem Handy; es
   * erst über uns laufen zu lassen hiesse, dass es nie hochgeladen wird.
   */
  async function bildSetzen(file: File | null) {
    if (!file || bildLaeuft) return;
    setBildLaeuft(true);
    try {
      await uploadProjektBild(projectId, file);
      // Neu laden statt die Adresse im Zustand zu halten: Sie ist kurzlebig
      // signiert und gehört deshalb dorthin, wo sie herkommt.
      await reload();
      toast('✓ Bild gespeichert.');
    } catch (error) {
      reportError(error, 'Das Bild konnte nicht gespeichert werden.');
    } finally {
      setBildLaeuft(false);
    }
  }

  function bildEntfernen() {
    confirm('Das Bild der Liegenschaft entfernen?', async () => {
      await removeProjektBild(projectId);
      await reload();
      toast('🗑️ Bild entfernt.');
    });
  }

  const laden = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        api<{ infos: ProjektInfo[]; ohneTabelle?: boolean }>(
          `/api/projects/${projectId}/infos`,
        ),
        api<{ kontakte: ProjektKontakt[]; ohneTabelle?: boolean; ohneTage?: boolean }>(
          `/api/projects/${projectId}/contacts`,
        ),
      ]);
      setInfos(a.infos);
      setKontakte(b.kontakte);
      setOhneTabelle(Boolean(a.ohneTabelle || b.ohneTabelle));
      setOhneTage(Boolean(b.ohneTage));
    } catch (error) {
      reportError(error, 'Die Projektinformationen konnten nicht geladen werden.');
      setInfos([]);
      setKontakte([]);
    }
  }, [projectId, reportError]);

  /** Die fünf Angaben auf einmal anlegen, die bei jeder Anlage gebraucht werden. */
  async function standardAnlegen() {
    if (busy) return;
    setBusy(true);
    try {
      for (const titel of STANDARD_ANGABEN) {
        await post(`/api/projects/${projectId}/infos`, { titel, text: '' });
      }
      await laden();
      toast('✓ Standardangaben angelegt – jetzt nur noch ausfüllen.');
    } catch (error) {
      reportError(error, 'Standardangaben konnten nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  }

  async function infoAnlegen() {
    if (!neueInfo || busy) return;
    if (!neueInfo.titel.trim()) {
      reportError(new Error('Bitte einen Titel angeben.'), 'Nicht gespeichert.');
      return;
    }

    setBusy(true);
    try {
      await post(`/api/projects/${projectId}/infos`, neueInfo);
      setNeueInfo(null);
      await laden();
      toast('✓ Angabe hinzugefügt.');
    } catch (error) {
      reportError(error, 'Angabe konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }

  async function infoSpeichern(i: ProjektInfo) {
    if (busy) return;
    if (!infoEntwurf.titel.trim()) {
      reportError(new Error('Bitte einen Titel angeben.'), 'Nicht gespeichert.');
      return;
    }

    setBusy(true);
    try {
      await patch(`/api/project-infos/${i.id}`, infoEntwurf);
      setInfoBearbeitet(null);
      await laden();
      toast('✓ Gespeichert.');
    } catch (error) {
      reportError(error, 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  function infoLoeschen(i: ProjektInfo) {
    confirm(`„${i.titel}“ entfernen?`, async () => {
      await del(`/api/project-infos/${i.id}`);
      await laden();
      toast('🗑️ Entfernt.');
    });
  }

  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  async function anlegen() {
    if (!neu || busy) return;
    if (!neu.rolle.trim()) {
      reportError(new Error('Bitte eine Funktion angeben.'), 'Nicht gespeichert.');
      return;
    }

    setBusy(true);
    try {
      await post(`/api/projects/${projectId}/contacts`, neu);
      setNeu(null);
      await laden();
      toast('✓ Kontakt hinzugefügt.');
    } catch (error) {
      reportError(error, 'Kontakt konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  }

  async function speichern(k: ProjektKontakt) {
    if (busy) return;
    if (!entwurf.rolle.trim()) {
      reportError(new Error('Bitte eine Funktion angeben.'), 'Nicht gespeichert.');
      return;
    }

    setBusy(true);
    try {
      await patch(`/api/project-contacts/${k.id}`, entwurf);
      setBearbeitet(null);
      await laden();
      toast('✓ Gespeichert.');
    } catch (error) {
      reportError(error, 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  function loeschen(k: ProjektKontakt) {
    const wer = k.name?.trim() || k.rolle;
    confirm(`„${wer}“ aus der Liste entfernen?`, async () => {
      await del(`/api/project-contacts/${k.id}`);
      await laden();
      toast('🗑️ Entfernt.');
    });
  }

  function bearbeiten(k: ProjektKontakt) {
    setBearbeitet(k.id);
    setNeu(null);
    setEntwurf({
      rolle: k.rolle,
      name: k.name ?? '',
      firma: k.firma ?? '',
      telefon: k.telefon ?? '',
      email: k.email ?? '',
      notiz: k.notiz ?? '',
      tage: k.tage ?? [],
    });
  }

  function felder(wert: Entwurf, setzen: (e: Entwurf) => void, listenId: string) {
    return (
      <div className="pkontakt-form">
        <input
          type="text"
          value={wert.rolle}
          list={listenId}
          onChange={(e) => setzen({ ...wert, rolle: e.target.value })}
          placeholder="Funktion, z.B. Hauswart"
          aria-label="Funktion"
        />
        <datalist id={listenId}>
          {ROLLEN.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>

        <input
          type="text"
          value={wert.name}
          onChange={(e) => setzen({ ...wert, name: e.target.value })}
          placeholder="Name"
          aria-label="Name"
        />
        <input
          type="text"
          value={wert.firma}
          onChange={(e) => setzen({ ...wert, firma: e.target.value })}
          placeholder="Firma (optional)"
          aria-label="Firma"
        />
        <input
          type="tel"
          value={wert.telefon}
          onChange={(e) => setzen({ ...wert, telefon: e.target.value })}
          placeholder="Telefon"
          aria-label="Telefon"
        />
        <input
          type="email"
          value={wert.email}
          onChange={(e) => setzen({ ...wert, email: e.target.value })}
          placeholder="E-Mail (optional)"
          aria-label="E-Mail"
        />
        <input
          type="text"
          value={wert.notiz}
          onChange={(e) => setzen({ ...wert, notiz: e.target.value })}
          placeholder="Notiz, z.B. Schlüssel bei ihm"
          aria-label="Notiz"
        />

        {/* Anwesenheit: Der Hauswart ist dienstags und donnerstags da, die
            Bauleitung nur montags. Nichts anzuwählen heisst "immer" – das
            steht auch so darunter, sonst liest es sich wie "nie". */}
        <div className="tage-wahl" role="group" aria-label="Tage vor Ort">
          {WOCHENTAGE.map((t) => {
            const an = wert.tage.includes(t.nummer);
            return (
              <button
                key={t.nummer}
                type="button"
                className={`tage-knopf ${an ? 'an' : ''}`}
                aria-pressed={an}
                title={t.lang}
                onClick={() =>
                  setzen({
                    ...wert,
                    tage: an
                      ? wert.tage.filter((n) => n !== t.nummer)
                      : [...wert.tage, t.nummer].sort((a, b) => a - b),
                  })
                }
              >
                {t.kurz}
              </button>
            );
          })}
        </div>
        <p className="tage-hinweis">
          {wert.tage.length
            ? `Vor Ort: ${tageText(wert.tage)}`
            : 'Kein Tag angewählt = immer vor Ort.'}
        </p>
      </div>
    );
  }

  if (!kontakte || !infos) return <Spinner size={36} label="Lade Projektinfos…" />;

  return (
    <div>
      <p className="pkontakt-erklaerung">
        Alles, was man wissen muss, bevor man hinfährt. Alle Beteiligten sehen die
        Angaben und dürfen sie ergänzen und ändern – wer vor Ort ist, kennt den
        Zugangscode oft zuerst. Entfernen kann nur die Swiss Solar Ventures AG.
      </p>

      {ohneTabelle && (
        <p className="speicher-hinweis">
          Projektinformationen gibt es erst nach der Datenbank-Aktualisierung 0029.
        </p>
      )}

      {/* Ganz oben und ohne Überschrift: Ein Foto sagt mehr über eine Baustelle
          als drei Zeilen Adresse – Flachdach oder Schrägdach, Gerüst nötig oder
          nicht, wo der Lieferwagen hinkommt. Wer zum ersten Mal hinfährt,
          erkennt daran, ob er richtig ist. */}
      <div className="liegenschaft">
        {bildUrl ? (
          <>
            {/* Anklickbar, weil auf einem Luftbild die Einzelheiten zählen –
                wo der Kran hinkommt, wie die Module liegen. In der Kachel
                erkennt man das nicht, im Vollbild schon. */}
            <a
              href={bildUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="liegenschaft-link"
              title="Gross ansehen"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="liegenschaft-bild"
                src={bildUrl}
                alt={detail.project.name}
              />
            </a>
            <div className="liegenschaft-knoepfe">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => bildWahl.current?.click()}
                disabled={bildLaeuft}
              >
                {bildLaeuft ? 'Wird geladen…' : '📷 Bild austauschen'}
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={bildEntfernen}
                  disabled={bildLaeuft}
                >
                  🗑️ Entfernen
                </button>
              )}
            </div>
          </>
        ) : (
          <button
            type="button"
            className="liegenschaft-leer"
            onClick={() => bildWahl.current?.click()}
            disabled={bildLaeuft}
          >
            <span className="liegenschaft-zeichen">📷</span>
            <span>
              {bildLaeuft
                ? 'Wird geladen…'
                : 'Bild der Liegenschaft hinzufügen'}
            </span>
            <span className="liegenschaft-hinweis">
              Ein Foto von aussen genügt – daran erkennt man beim ersten Mal, ob
              man richtig ist.
            </span>
          </button>
        )}

        {/* Bewusst ohne capture: Auf dem Handy bietet die Auswahl dann sowohl
            die Kamera als auch die Galerie an. Mit capture ginge nur noch die
            Kamera – und das Foto vom letzten Besuch liegt schon im Telefon. */}
        <input
          ref={bildWahl}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            void bildSetzen(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </div>

      <h4 className="pkontakt-titel">Angaben zum Objekt</h4>

      <div className="datenblatt">

      {infos.map((i) =>
        infoBearbeitet === i.id ? (
          <div className="pkontakt bearbeitet" key={i.id}>
            <div className="pkontakt-form">
              <input
                type="text"
                value={infoEntwurf.titel}
                list="info-titel"
                onChange={(e) =>
                  setInfoEntwurf({ ...infoEntwurf, titel: e.target.value })
                }
                placeholder="Titel, z.B. Zugang"
                aria-label="Titel"
              />
              <textarea
                value={infoEntwurf.text}
                rows={3}
                onChange={(e) => setInfoEntwurf({ ...infoEntwurf, text: e.target.value })}
                placeholder="z.B. Schlüssel beim Hauswart, Tiefgarage Code 4711"
                aria-label="Text"
              />
            </div>
            <div className="kontakt-knoepfe">
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => void infoSpeichern(i)}
                disabled={busy}
              >
                Speichern
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setInfoBearbeitet(null)}
              >
                Abbrechen
              </button>
              {/* Löschen bleibt bei uns: Ergänzen ist harmlos, Wegnehmen nicht.
                  Eine falsche Zeile lässt sich korrigieren, eine gelöschte ist
                  weg. Die Datenbank verweigert es zusätzlich. */}
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => infoLoeschen(i)}
                >
                  🗑️ Entfernen
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="datenzeile" key={i.id}>
            <div className="datenzeile-name">{i.titel}</div>
            <div className={`datenzeile-wert ${i.text?.trim() ? '' : 'offen'}`}>
              {i.text?.trim() || 'noch nicht erfasst'}
            </div>
            {(
              <button
                type="button"
                className="datenzeile-stift"
                title="Ändern"
                aria-label={`${i.titel} ändern`}
                onClick={() => {
                  setInfoBearbeitet(i.id);
                  setNeueInfo(null);
                  setInfoEntwurf({ titel: i.titel, text: i.text ?? '' });
                }}
              >
                ✏️
              </button>
            )}
          </div>
        ),
      )}

      </div>

      <datalist id="info-titel">
        {INFO_TITEL.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {!infos.length && !ohneTabelle && (
        <>
          <p className="leer-hinweis">Noch keine Angaben erfasst.</p>
          {isAdmin && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void standardAnlegen()}
              disabled={busy}
            >
              {busy ? 'Einen Moment…' : `⚡ Standardangaben anlegen (${STANDARD_ANGABEN.join(', ')})`}
            </button>
          )}
        </>
      )}

      {(neueInfo ? (
          <div className="pkontakt bearbeitet">
            <div className="pkontakt-form">
              <input
                type="text"
                value={neueInfo.titel}
                list="info-titel"
                onChange={(e) => setNeueInfo({ ...neueInfo, titel: e.target.value })}
                placeholder="Titel, z.B. Zugang"
                aria-label="Titel"
              />
              <textarea
                value={neueInfo.text}
                rows={3}
                onChange={(e) => setNeueInfo({ ...neueInfo, text: e.target.value })}
                placeholder="z.B. Schlüssel beim Hauswart, Tiefgarage Code 4711"
                aria-label="Text"
              />
            </div>
            <div className="kontakt-knoepfe">
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => void infoAnlegen()}
                disabled={busy}
              >
                {busy ? 'Einen Moment…' : 'Hinzufügen'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setNeueInfo(null)}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="new-project-btn"
            onClick={() => {
              setNeueInfo({ titel: '', text: '' });
              setInfoBearbeitet(null);
            }}
          >
            + Angabe hinzufügen
          </button>
        ))}

      <h4 className="pkontakt-titel">Kontakte vor Ort</h4>

      {ohneTage && (
        <p className="speicher-hinweis">
          Die Tage vor Ort lassen sich erst nach der Datenbank-Aktualisierung 0032
          speichern. Alles andere am Kontakt wird ganz normal gesichert.
        </p>
      )}

      <div className="kontakt-karten">

      {kontakte.map((k) => {
        if (bearbeitet === k.id) {
          return (
            <div className="pkontakt bearbeitet" key={k.id}>
              {felder(entwurf, setEntwurf, `rollen-${k.id}`)}
              <div className="kontakt-knoepfe">
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={() => void speichern(k)}
                  disabled={busy}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setBearbeitet(null)}
                >
                  Abbrechen
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => loeschen(k)}
                  >
                    🗑️ Entfernen
                  </button>
                )}
              </div>
            </div>
          );
        }

        const nummer = waNummer(k.telefon);

        return (
          <div className="kontakt-karte" key={k.id}>
            <div className="kontakt-karte-kopf">
              <span className="pkontakt-rolle">{k.rolle}</span>
              {(
                <button
                  type="button"
                  className="datenzeile-stift"
                  title="Ändern"
                  aria-label={`${k.rolle} ändern`}
                  onClick={() => bearbeiten(k)}
                >
                  ✏️
                </button>
              )}
            </div>
            <div className="pkontakt-name">
              {k.name?.trim() || '—'}
              {k.firma && <span className="kontakt-firma"> · {k.firma}</span>}
            </div>

            {/* Nur bei fester Anwesenheit eine Zeile. "Immer vor Ort" bei jedem
                zweiten Kontakt hinzuschreiben wäre Lärm – und wer heute anruft,
                will wissen, ob heute jemand da ist. */}
            {k.tage.length > 0 && (
              <div
                className={`pkontakt-tage ${istHeuteVorOrt(k.tage) ? 'heute' : ''}`}
                title={istHeuteVorOrt(k.tage) ? 'Heute vor Ort' : 'Heute nicht vor Ort'}
              >
                📆 {tageText(k.tage)}
                <span className="pkontakt-heute">
                  {istHeuteVorOrt(k.tage) ? '· heute da' : '· heute nicht'}
                </span>
              </div>
            )}

            {k.notiz && <div className="pkontakt-notiz">{k.notiz}</div>}

            {/* Auf der Baustelle zählt der eine Griff zum Anruf – deshalb sind
                Nummer und Adresse anklickbar und nicht nur abgedruckt. */}
            <div className="pkontakt-wege">
              {k.telefon && (
                <a className="btn btn-ghost btn-sm" href={`tel:${k.telefon}`}>
                  📞 {k.telefon}
                </a>
              )}
              {nummer && (
                <WhatsAppButton
                  nummer={nummer}
                  text=""
                  titel={`${k.rolle} über WhatsApp anschreiben`}
                />
              )}
              {k.email && (
                <a className="btn btn-ghost btn-sm" href={`mailto:${k.email}`}>
                  ✉️ {k.email}
                </a>
              )}
            </div>
          </div>
        );
      })}

      </div>

      {!kontakte.length && !ohneTabelle && (
        <p className="leer-hinweis">Für dieses Projekt ist noch niemand erfasst.</p>
      )}

      {(neu ? (
          <div className="pkontakt bearbeitet">
            {felder(neu, setNeu, 'rollen-neu')}
            <div className="kontakt-knoepfe">
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => void anlegen()}
                disabled={busy}
              >
                {busy ? 'Einen Moment…' : 'Hinzufügen'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setNeu(null)}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="new-project-btn"
            onClick={() => {
              setNeu(LEER);
              setBearbeitet(null);
            }}
          >
            + Kontakt hinzufügen
          </button>
        ))}

      {/* Steht bewusst am Schluss und ohne Bearbeiten-Knopf: Die Liste ergibt
          sich aus den Freigaben im Register "Lieferanten". */}
      <h4 className="pkontakt-titel">Beteiligte Lieferanten</h4>

      <div className="kontakt-karten">

      {beteiligte.map((l) => {
        const nummer = waNummer(l.kontakt);

        return (
          <div className="kontakt-karte" key={l.id}>
            <div className="kontakt-karte-kopf">
              <span className="pkontakt-rolle">{l.gewerk?.trim() || 'Lieferant'}</span>
            </div>
            <div className="pkontakt-name">
              {l.firma?.trim() || l.name?.trim() || '—'}
              {l.firma && l.name && <span className="kontakt-firma"> · {l.name}</span>}
            </div>
            <div className="pkontakt-wege">
              {l.kontakt && (
                <a className="btn btn-ghost btn-sm" href={`tel:${l.kontakt}`}>
                  📞 {l.kontakt}
                </a>
              )}
              {nummer && (
                <WhatsAppButton
                  nummer={nummer}
                  text=""
                  titel={`${l.firma ?? l.name ?? ''} über WhatsApp anschreiben`}
                />
              )}
              {l.email && (
                <a className="btn btn-ghost btn-sm" href={`mailto:${l.email}`}>
                  ✉️ {l.email}
                </a>
              )}
            </div>
          </div>
        );
      })}

      </div>

      {!beteiligte.length && (
        <p className="leer-hinweis">
          Für dieses Projekt ist noch kein Lieferant freigegeben.
          {isAdmin && ' Das stellst du im Register „Lieferanten" ein.'}
        </p>
      )}
    </div>
  );
}
