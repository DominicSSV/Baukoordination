import { NextResponse } from 'next/server';
import { handler, ok } from '@/lib/api';
import { serviceClient } from '@/lib/supabase/service';
import {
  allAssigneeRecipients,
  mailEnabled,
  sendFristErinnerung,
  sendOverdueNotice,
} from '@/lib/email';
import { fmtDueDate, heute } from '@/lib/due';
import { tagPlus } from '@/lib/schedule';
import { beteiligteLieferanten } from '@/lib/beteiligte';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type FaelligeAufgabe = {
  id: string;
  text: string;
  assigned_to: string;
  assignees: string[] | null;
  vertraulich?: boolean | null;
  created_by_supplier_id?: string | null;
  due_date: string;
  project_id: string;
  projects: { name: string } | null;
};

/**
 * Täglicher Prüflauf auf Fristen – drei Stufen in einem Lauf.
 *
 * Erinnerung zwei Tage vorher, Erinnerung am Tag selbst, Mahnung am Tag danach.
 * Jede Stufe hat ihren eigenen Vermerk (erinnert_am, erinnert_heute_am,
 * overdue_notified_at). Mit einem gemeinsamen unterdrückte
 * die eine Meldung die anderen: Wer zwei Tage vorher erinnert wurde, bekäme am
 * Tag selbst nichts mehr.
 *
 * Wird die Frist später verschoben, setzt die Aufgaben-Route alle drei zurück,
 * und für den neuen Termin wird erneut erinnert und gemahnt.
 *
 * Wird von Vercel Cron aufgerufen (siehe vercel.json).
 */
export const GET = handler(async (request: Request) => {
  // Vercel schickt bei gesetztem CRON_SECRET einen Bearer-Token mit. Ist kein
  // Secret hinterlegt, bleibt der Aufruf offen – dann kann er höchstens eine
  // ohnehin fällige Mahnung auslösen, aber keine Daten preisgeben.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get('authorization');
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 });
    }
  }

  const db = serviceClient();
  const stichtag = heute();
  // Zwei Tage Vorlauf: früh genug, um noch Material zu bestellen oder
  // einen Kran zu organisieren. Ein Tag reicht dafür meistens nicht.
  const vorlauf = tagPlus(stichtag, 2);

  /**
   * Die Aufgaben eines Durchgangs.
   *
   * "vorlauf" sucht den übernächsten Tag, "heute" den heutigen, "ueberfaellig"
   * alles davor – jede Stufe mit ihrem eigenen Vermerk, damit keine die andere
   * unterdrückt.
   */
  const abfrage = (spalten: string, art: 'vorlauf' | 'heute' | 'ueberfaellig') => {
    const basis = db
      .from('todos')
      .select(spalten)
      .eq('done', false)
      // Für eine weggeräumte Aufgabe zu mahnen wäre das Peinlichste: eine Mail
      // über etwas, das der Empfänger in der App gar nicht mehr findet.
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .limit(200);

    if (art === 'vorlauf') return basis.eq('due_date', vorlauf).is('erinnert_am', null);
    if (art === 'heute') {
      return basis.eq('due_date', stichtag).is('erinnert_heute_am', null);
    }
    return basis.lt('due_date', stichtag).is('overdue_notified_at', null);
  };

  const spaltenNeu =
    'id, text, assigned_to, assignees, vertraulich, created_by_supplier_id, due_date, project_id, projects(name)';
  const spaltenAlt = 'id, text, assigned_to, due_date, project_id, projects(name)';

  const mitListe = await abfrage(spaltenNeu, 'ueberfaellig');

  // Ohne Migration 0014 gibt es die Spalte assignees noch nicht.
  const alteSpalten = Boolean(mitListe.error);
  const { data, error } = alteSpalten
    ? await abfrage(spaltenAlt, 'ueberfaellig')
    : mitListe;

  if (error) {
    return NextResponse.json(
      { error: `Fällige Aufgaben nicht ladbar: ${error.message}` },
      { status: 500 },
    );
  }

  const aufgaben = (data ?? []) as unknown as FaelligeAufgabe[];

  if (!mailEnabled()) {
    return ok({
      ueberfaellig_geprueft: aufgaben.length,
      gemahnt: 0,
      vorlauf_erinnert: 0,
      heute_erinnert: 0,
      hinweis: 'Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt).',
    });
  }

  let gemahnt = 0;
  const fehler: string[] = [];

  /**
   * Schlägt eine Erinnerungs-Abfrage fehl, fehlt Migration 0035 – dann bleibt
   * es bei der Mahnung. Eine fehlende Erinnerung ist ärgerlich, ein
   * abgebrochener Prüflauf wäre schlimmer: Danach ginge auch keine Mahnung
   * mehr hinaus.
   */
  const spalten = alteSpalten ? spaltenAlt : spaltenNeu;

  /** Ein Erinnerungs-Durchgang: abfragen, verschicken, vermerken. */
  const erinnern = async (wann: 'vorlauf' | 'heute', vermerk: string) => {
    const res = await abfrage(spalten, wann);
    const liste = res.error ? [] : ((res.data ?? []) as unknown as FaelligeAufgabe[]);
    let versendet = 0;

    for (const aufgabe of liste) {
      try {
        const empfaenger = await allAssigneeRecipients(
          aufgabe.assignees,
          aufgabe.assigned_to,
        );

        if (empfaenger.length) {
          await sendFristErinnerung({
            to: empfaenger,
            todoText: aufgabe.text,
            projectName: aufgabe.projects?.name ?? 'Projekt',
            dueLabel: fmtDueDate(aufgabe.due_date),
            wann,
          });
          versendet += 1;
        }

        // Auch ohne erreichbaren Empfänger vermerken, sonst läuft die Aufgabe
        // jeden Tag erneut durch die Schleife.
        await db
          .from('todos')
          .update({ [vermerk]: new Date().toISOString() })
          .eq('id', aufgabe.id);
      } catch (e) {
        fehler.push(
          `${aufgabe.text} (${wann}): ${e instanceof Error ? e.message : 'unbekannter Fehler'}`,
        );
      }
    }

    return { gefunden: liste.length, versendet, fehlgeschlagen: Boolean(res.error) };
  };

  // Erst der Vorlauf, dann der Tag selbst – in der Reihenfolge, in der sie im
  // Postfach ankommen sollen.
  const vorlaufLauf = await erinnern('vorlauf', 'erinnert_am');
  const heuteLauf = await erinnern('heute', 'erinnert_heute_am');

  // Die Erinnerungen stehen bewusst nicht im Protokoll: Sie melden nichts
  // Geschehenes, nur einen Termin, der ohnehin an der Aufgabe steht. Im
  // Protokoll wären sie täglich wiederkehrendes Rauschen.

  for (const aufgabe of aufgaben) {
    try {
      const empfaenger = await allAssigneeRecipients(
        aufgabe.assignees,
        aufgabe.assigned_to,
      );

      if (empfaenger.length) {
        const tage = Math.max(
          1,
          Math.round(
            (Date.parse(`${stichtag}T00:00:00Z`) -
              Date.parse(`${aufgabe.due_date}T00:00:00Z`)) /
              86_400_000,
          ),
        );

        await sendOverdueNotice({
          to: empfaenger,
          todoText: aufgabe.text,
          projectName: aufgabe.projects?.name ?? 'Projekt',
          dueLabel: fmtDueDate(aufgabe.due_date),
          tageUeberfaellig: tage,
        });

        gemahnt += 1;
      }

      // Auch ohne erreichbaren Empfänger vermerken, sonst läuft die Aufgabe jeden
      // Tag erneut durch die Schleife.
      await db
        .from('todos')
        .update({ overdue_notified_at: new Date().toISOString() })
        .eq('id', aufgabe.id);

      // Im Protokoll sichtbar machen, ohne die übliche Rundmail auszulösen –
      // die Mahnung ging bereits gezielt an die Zuständigen. Bei einer
      // vertraulichen Aufgabe sieht den Eintrag nur, wen sie etwas angeht.
      const eintrag: Record<string, unknown> = {
        project_id: aufgabe.project_id,
        actor_name: 'Baukoordination',
        text: `hat an die überschrittene Frist für "${aufgabe.text}" erinnert`,
        icon: '⏰',
      };

      const geschuetzt = await db.from('activity').insert(
        aufgabe.vertraulich
          ? { ...eintrag, supplier_ids: beteiligteLieferanten(aufgabe) }
          : eintrag,
      );

      // Ohne Migration 0015 gibt es die Spalte supplier_ids noch nicht.
      if (geschuetzt.error) await db.from('activity').insert(eintrag);
    } catch (e) {
      fehler.push(
        `${aufgabe.text}: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`,
      );
    }
  }

  return ok({
    in_zwei_tagen_faellig: vorlaufLauf.gefunden,
    vorlauf_erinnert: vorlaufLauf.versendet,
    heute_faellig: heuteLauf.gefunden,
    heute_erinnert: heuteLauf.versendet,
    ueberfaellig_geprueft: aufgaben.length,
    gemahnt,
    ...(vorlaufLauf.fehlgeschlagen || heuteLauf.fehlgeschlagen
      ? { hinweis: 'Die Erinnerungen brauchen Migration 0035.' }
      : {}),
    fehler,
  });
});
