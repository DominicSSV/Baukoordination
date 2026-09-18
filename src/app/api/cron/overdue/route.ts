import { NextResponse } from 'next/server';
import { handler, ok } from '@/lib/api';
import { serviceClient } from '@/lib/supabase/service';
import {
  allAssigneeRecipients,
  mailEnabled,
  sendDueTomorrowNotice,
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
 * Täglicher Prüflauf auf Fristen – zwei Durchgänge in einem Lauf.
 *
 * Erst die Erinnerung für morgen, dann die Mahnung für alles Überschrittene.
 * Zwei Vermerke halten auseinander, was schon hinausging: erinnert_am und
 * overdue_notified_at. Mit einem gemeinsamen Vermerk unterdrückte die eine
 * Meldung die andere – wer am Vortag erinnert wurde, bekäme keine Mahnung mehr.
 *
 * Wird die Frist später verschoben, setzt die Aufgaben-Route beide zurück, und
 * für den neuen Termin wird erneut erinnert und gemahnt.
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
  const morgen = tagPlus(stichtag, 1);

  /**
   * Die Aufgaben eines Durchgangs.
   *
   * "morgen" sucht nach genau dem morgigen Tag und einem leeren erinnert_am,
   * "ueberfaellig" nach allem vor heute und einem leeren overdue_notified_at.
   */
  const abfrage = (spalten: string, art: 'morgen' | 'ueberfaellig') => {
    const basis = db
      .from('todos')
      .select(spalten)
      .eq('done', false)
      // Für eine weggeräumte Aufgabe zu mahnen wäre das Peinlichste: eine Mail
      // über etwas, das der Empfänger in der App gar nicht mehr findet.
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .limit(200);

    return art === 'morgen'
      ? basis.eq('due_date', morgen).is('erinnert_am', null)
      : basis.lt('due_date', stichtag).is('overdue_notified_at', null);
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
      erinnert: 0,
      hinweis: 'Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt).',
    });
  }

  let gemahnt = 0;
  const fehler: string[] = [];

  /**
   * Erster Durchgang: Was morgen fällig ist.
   *
   * Schlägt die Abfrage fehl, fehlt Migration 0035 – dann bleibt es bei der
   * Mahnung. Eine fehlende Erinnerung ist ärgerlich, ein abgebrochener
   * Prüflauf wäre schlimmer: Danach ginge auch keine Mahnung mehr hinaus.
   */
  const morgenRes = await abfrage(alteSpalten ? spaltenAlt : spaltenNeu, 'morgen');
  const morgenAufgaben = morgenRes.error
    ? []
    : ((morgenRes.data ?? []) as unknown as FaelligeAufgabe[]);

  let erinnert = 0;

  for (const aufgabe of morgenAufgaben) {
    try {
      const empfaenger = await allAssigneeRecipients(
        aufgabe.assignees,
        aufgabe.assigned_to,
      );

      if (empfaenger.length) {
        await sendDueTomorrowNotice({
          to: empfaenger,
          todoText: aufgabe.text,
          projectName: aufgabe.projects?.name ?? 'Projekt',
          dueLabel: fmtDueDate(aufgabe.due_date),
        });
        erinnert += 1;
      }

      // Auch ohne erreichbaren Empfänger vermerken, sonst läuft die Aufgabe
      // jeden Tag erneut durch die Schleife.
      await db
        .from('todos')
        .update({ erinnert_am: new Date().toISOString() })
        .eq('id', aufgabe.id);
    } catch (e) {
      fehler.push(
        `${aufgabe.text} (Erinnerung): ${e instanceof Error ? e.message : 'unbekannter Fehler'}`,
      );
    }
  }

  // Die Erinnerung steht bewusst nicht im Protokoll: Sie meldet nichts
  // Geschehenes, nur einen Termin, der ohnehin an der Aufgabe steht. Im
  // Protokoll wäre sie täglich wiederkehrendes Rauschen.

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
    morgen_faellig: morgenAufgaben.length,
    erinnert,
    ueberfaellig_geprueft: aufgaben.length,
    gemahnt,
    ...(morgenRes.error
      ? { hinweis: 'Erinnerung am Vortag braucht Migration 0035.' }
      : {}),
    fehler,
  });
});
