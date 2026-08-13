'use client';

import { useEffect, useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import { adminAssignee, assigneeLabel, supplierAssignee, INTERNAL } from '@/lib/assignee';
import { INTERNAL_PARTY } from '@/lib/branding';
import { supplierLabel } from '@/lib/format';
import { mitFirma } from '@/lib/people';
import type { AdminProfile, Supplier } from '@/types';

/**
 * Auswahl der Zuständigen einer Aufgabe – mehrere gleichzeitig möglich.
 *
 * Ein einfaches Mehrfach-Auswahlfeld des Browsers wäre auf dem Handy kaum
 * bedienbar, deshalb eine Liste zum Ankreuzen. Ohne Auswahl bleibt die Aufgabe
 * bei der Swiss Solar Ventures AG – eine Aufgabe ohne Zuständigen sieht niemand.
 */
export default function AssigneePicker({
  value,
  onChange,
  admins,
  suppliers,
  erlaubtIntern,
}: {
  value: string[];
  onChange: (werte: string[]) => void;
  admins: AdminProfile[];
  /** Leer, wenn der Anmeldende keine Lieferanten zuweisen darf. */
  suppliers: Supplier[];
  /** Nur solange kein Bauherrenvertreter hinterlegt ist. */
  erlaubtIntern: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const feldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!offen) return;

    function beiKlick(e: MouseEvent) {
      if (!feldRef.current?.contains(e.target as Node)) setOffen(false);
    }
    function beiTaste(e: KeyboardEvent) {
      if (e.key === 'Escape') setOffen(false);
    }

    document.addEventListener('mousedown', beiKlick);
    document.addEventListener('keydown', beiTaste);
    return () => {
      document.removeEventListener('mousedown', beiKlick);
      document.removeEventListener('keydown', beiTaste);
    };
  }, [offen]);

  function umschalten(wert: string) {
    onChange(
      value.includes(wert) ? value.filter((v) => v !== wert) : [...value, wert],
    );
  }

  const eintraege = [
    ...(erlaubtIntern
      ? [{ wert: INTERNAL, name: INTERNAL_PARTY, avatarUrl: null, gruppe: INTERNAL_PARTY }]
      : []),
    ...admins.map((a) => ({
      wert: adminAssignee(a.user_id),
      name: a.name,
      avatarUrl: a.avatar_url ?? null,
      gruppe: INTERNAL_PARTY,
    })),
    ...suppliers.map((s) => ({
      wert: supplierAssignee(s.id),
      name: mitFirma(supplierLabel(s), s.firma),
      avatarUrl: s.avatar_url ?? null,
      gruppe: 'Lieferanten',
    })),
  ];

  // Zuständige, die nicht (mehr) zur Auswahl stehen – etwa ein Lieferant, dem der
  // Zugriff entzogen wurde. Sie bleiben sichtbar und abwählbar.
  const bekannt = new Set(eintraege.map((e) => e.wert));
  const fremde = value.filter((v) => !bekannt.has(v));

  const gruppen = Array.from(new Set(eintraege.map((e) => e.gruppe)));

  const beschriftung = value.length
    ? value
        .slice(0, 2)
        .map((v) => assigneeLabel(v, admins, suppliers))
        .join(', ') + (value.length > 2 ? ` +${value.length - 2}` : '')
    : 'Zuständig wählen …';

  return (
    <div className="zust-feld" ref={feldRef}>
      <button
        type="button"
        className="zust-knopf"
        onClick={() => setOffen((a) => !a)}
        aria-expanded={offen}
        title="Zuständige wählen"
      >
        <span className="zust-text">{beschriftung}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {offen && (
        <div className="zust-liste">
          {fremde.map((v) => (
            <label key={v} className="zust-eintrag">
              <input
                type="checkbox"
                checked
                onChange={() => umschalten(v)}
              />
              <span>{assigneeLabel(v, admins, suppliers)} (bisher)</span>
            </label>
          ))}

          {gruppen.map((g) => (
            <div key={g}>
              <div className="zust-gruppe">{g}</div>
              {eintraege
                .filter((e) => e.gruppe === g)
                .map((e) => (
                  <label key={e.wert} className="zust-eintrag">
                    <input
                      type="checkbox"
                      checked={value.includes(e.wert)}
                      onChange={() => umschalten(e.wert)}
                    />
                    <Avatar url={e.avatarUrl} name={e.name} size={22} />
                    <span>{e.name}</span>
                  </label>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
