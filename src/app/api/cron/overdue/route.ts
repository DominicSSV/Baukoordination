import { NextResponse } from 'next/server';
import { handler, ok } from '@/lib/api';
import { serviceClient } from '@/lib/supabase/service';
import { allAssigneeRecipients, mailEnabled, sendOverdueNotice } from '@/lib/email';
import { fmtDueDate, heute } from '@/lib/due';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type FaelligeAufgabe = {
  id: string;
  text: string;
  assigned_to: string;
  assignees: string[] | null;
  due_date: string;
  project_id: string;
  projects: { name: string } | null;
};

/**
 * Täglicher Prüflauf auf überschrittene Fristen.
 *
 * Wird von Vercel Cron aufgerufen (siehe vercel.json). Jede überfällige, noch offene
 * Aufgabe löst genau eine dringende Mail an den Zuständigen aus; danach hält
 * overdue_notified_at fest, dass gemahnt wurde. Wird die Frist später verschoben,
 * setzt die Aufgaben-Route das Feld zurück und es wird erneut gemahnt.
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

  const abfrage = (spalten: string) =>
    db
      .from('todos')
      .select(spalten)
      .eq('done', false)
      .not('due_date', 'is', null)
      .lt('due_date', stichtag)
      .is('overdue_notified_at', null)
      .limit(200);

  const mitListe = await abfrage(
    'id, text, assigned_to, assignees, due_date, project_id, projects(name)',
  );

  // Ohne Migration 0014 gibt es die Spalte assignees noch nicht.
  const { data, error } = mitListe.error
    ? await abfrage('id, text, assigned_to, due_date, project_id, projects(name)')
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
      geprueft: aufgaben.length,
      gemahnt: 0,
      hinweis: 'Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt).',
    });
  }

  let gemahnt = 0;
  const fehler: string[] = [];

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
      // die Mahnung ging bereits gezielt an den Zuständigen.
      await db.from('activity').insert({
        project_id: aufgabe.project_id,
        actor_name: 'Baukoordination',
        text: `hat an die überschrittene Frist für "${aufgabe.text}" erinnert`,
        icon: '⏰',
      });
    } catch (e) {
      fehler.push(
        `${aufgabe.text}: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`,
      );
    }
  }

  return ok({ geprueft: aufgaben.length, gemahnt, fehler });
});
