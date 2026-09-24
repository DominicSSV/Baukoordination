import { ApiError, handler, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth/guards';
import { adminAssignee, parseAssignee, supplierAssignee } from '@/lib/assignee';
import { serviceClient } from '@/lib/supabase/service';
import { signAvatars } from '@/lib/avatars';
import type { AdminProfile, Supplier } from '@/types';

export const dynamic = 'force-dynamic';

/** Mehr als das braucht eine Übersicht nicht – sonst wird sie unlesbar. */
const ANZAHL = 300;

/**
 * So viele erledigte Aufgaben kommen dazu, wenn man sie sehen will.
 *
 * Deutlich weniger als die offenen, und in einer eigenen Abfrage: Erledigtes
 * wächst mit jedem Tag weiter, offene Aufgaben nicht. In einer gemeinsamen
 * Abfrage mit einer Obergrenze würden die abgehakten irgendwann die offenen
 * verdrängen – und dann fehlte genau das, weswegen man hier hereinschaut.
 */
const ANZAHL_ERLEDIGT = 100;

export type MeineAufgabe = {
  id: string;
  projectId: string;
  projectName: string;
  text: string;
  dueDate: string | null;
  /** true = abgehakt. Nur enthalten, wenn ausdrücklich danach gefragt wurde. */
  done: boolean;
  /** Wann abgehakt – danach ist die Liste der Erledigten geordnet. */
  doneAt: string | null;
  doneBy: string | null;
  assignees: string[];
  /**
   * Die übrigen Zuständigen – wer ausser mir noch an der Sache ist.
   *
   * An einem Gewerk sind oft zwei dran; dann ist es ein Unterschied, ob man
   * allein zuständig ist oder mit jemandem zusammen.
   */
  andere: string[];
  /** true = mir persönlich zugewiesen, nicht bloss meiner Firma. */
  meine: boolean;
  createdBy: string;
};

/**
 * Offene Aufgaben aus allen Projekten, auf die man Zugriff hat.
 *
 * Geliefert wird alles Sichtbare; ob nur die eigenen oder alle angezeigt
 * werden, entscheidet der Schalter in der Ansicht. Bewusst so herum: Das
 * Umschalten geht damit ohne neue Abfrage, und ein Grund, es serverseitig zu
 * beschneiden, gäbe es nur, wenn man das Übrige nicht sehen dürfte – man darf
 * es aber, es steht genauso im Projekt.
 *
 * Gelesen wird mit der Sitzung: fremde Projekte und vertrauliche Aufgaben
 * blendet die Datenbank selbst aus (Migrationen 0014/0015).
 *
 * Erledigtes bleibt standardmässig draussen – die Übersicht beantwortet die
 * Frage "was steht an", nicht "was war". Mit ?erledigte=1 kommt es dazu, in
 * einer eigenen Abfrage nach Zeitpunkt des Abhakens: Wer wissen will, was er
 * geschafft hat, sucht das Letzte zuerst.
 */
export const GET = handler(async (request: Request) => {
  const ctx = await requireSession();

  const mitErledigten =
    new URL(request.url).searchParams.get('erledigte') === '1';

  const spalten =
    'id, project_id, text, assigned_to, assignees, due_date, done, done_at, done_by, created_by, projects(name)';
  const spaltenAlt =
    'id, project_id, text, assigned_to, due_date, done, done_at, done_by, created_by, projects(name)';

  /**
   * deleted_at prüft die Datenbank nicht von sich aus: Der Papierkorb ist eine
   * Spalte, keine eigene Tabelle. Ohne diese Bedingung stehen weggeräumte
   * Aufgaben weiter in der Übersicht – Aufgaben, die es für den Benutzer nicht
   * mehr gibt.
   */
  const holen = (auswahl: string, erledigt: boolean) => {
    const abfrage = ctx.db
      .from('todos')
      .select(auswahl)
      .eq('done', erledigt)
      .is('deleted_at', null);

    return erledigt
      ? abfrage
          .order('done_at', { ascending: false, nullsFirst: false })
          .limit(ANZAHL_ERLEDIGT)
      : abfrage
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(ANZAHL);
  };

  const offenNeu = await holen(spalten, false);

  // Ohne Migration 0014 gibt es die Spalte assignees noch nicht.
  const alteSpalten = Boolean(offenNeu.error);
  const auswahl = alteSpalten ? spaltenAlt : spalten;

  const offen = alteSpalten ? await holen(spaltenAlt, false) : offenNeu;
  if (offen.error) throw new ApiError(`Aufgaben: ${offen.error.message}`, 500);

  const erledigt = mitErledigten ? await holen(auswahl, true) : null;
  if (erledigt?.error) {
    throw new ApiError(`Erledigte Aufgaben: ${erledigt.error.message}`, 500);
  }

  const rows = [...(offen.data ?? []), ...(erledigt?.data ?? [])] as unknown as Array<{
    id: string;
    project_id: string;
    text: string;
    assigned_to: string;
    assignees?: string[] | null;
    due_date: string | null;
    done: boolean;
    done_at: string | null;
    done_by: string | null;
    created_by: string;
    projects: { name: string } | null;
  }>;

  // Der eigene Zuständigkeitswert – damit lässt sich "meine" von "aus meiner
  // Firma" unterscheiden.
  const ich =
    ctx.session.kind === 'admin'
      ? adminAssignee(ctx.session.userId)
      : supplierAssignee(ctx.session.supplierId);

  const aufgaben: MeineAufgabe[] = rows.map((r) => {
    const assignees = r.assignees?.length ? r.assignees : [r.assigned_to];

    return {
      id: r.id,
      projectId: r.project_id,
      projectName: r.projects?.name ?? 'Projekt',
      text: r.text,
      dueDate: r.due_date,
      done: r.done === true,
      doneAt: r.done_at,
      doneBy: r.done_by,
      assignees,
      andere: assignees.filter((a) => a !== ich),
      meine:
        assignees.includes(ich) ||
        // Eine Aufgabe an die Firma allgemein geht uns alle etwas an. Bei den
        // Lieferanten gibt es das nicht: Dort ist immer eine Person gemeint.
        (ctx.session.kind === 'admin' &&
          assignees.some((a) => parseAssignee(a).kind === 'internal')),
      createdBy: r.created_by,
    };
  });

  /**
   * Die Personen, die in diesen Aufgaben vorkommen – mitgeliefert.
   *
   * Die Uebersicht geht ueber ALLE Projekte, bekam aber bisher nur die Leute
   * des gerade geoeffneten. Wer aus einem anderen Projekt zustaendig war,
   * stand als "Unbekannt" da – und direkt nach dem Anmelden, wenn noch kein
   * Projekt offen ist, galt das fuer alle.
   *
   * Gelesen wird mit dem Dienstschluessel und einer festen Spaltenauswahl.
   * Namen, Firma und Bild stehen ohnehin in jeder Aufgabenliste; Adressen,
   * Telefonnummern und Passwoerter verlassen diese Abfrage nie.
   */
  const gebraucht = new Set<string>();
  for (const a of aufgaben) for (const w of a.assignees) gebraucht.add(w);

  const adminIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const w of gebraucht) {
    const ziel = parseAssignee(w);
    if (ziel.kind === 'admin') adminIds.add(ziel.id);
    if (ziel.kind === 'supplier') supplierIds.add(ziel.id);
  }

  const dienst = serviceClient();
  const [adminRes, supplierRes] = await Promise.all([
    adminIds.size
      ? dienst
          .from('admins')
          .select('user_id, name, firma, funktion, avatar_path')
          .in('user_id', Array.from(adminIds))
      : Promise.resolve({ data: [], error: null }),
    supplierIds.size
      ? dienst
          .from('suppliers')
          .select('id, name, firma, gewerk, avatar_path')
          .in('id', Array.from(supplierIds))
      : Promise.resolve({ data: [], error: null }),
  ]);

  const adminZeilen = (adminRes.error ? [] : (adminRes.data ?? [])) as Array<{
    user_id: string;
    name: string | null;
    firma: string | null;
    funktion: string | null;
    avatar_path: string | null;
  }>;
  const supplierZeilen = (supplierRes.error ? [] : (supplierRes.data ?? [])) as Array<{
    id: string;
    name: string | null;
    firma: string | null;
    gewerk: string | null;
    avatar_path: string | null;
  }>;

  const bilder = await signAvatars([
    ...adminZeilen.map((a) => a.avatar_path),
    ...supplierZeilen.map((z) => z.avatar_path),
  ]);

  const admins: AdminProfile[] = adminZeilen.map((a) => ({
    user_id: a.user_id,
    name: a.name ?? '',
    firma: a.firma ?? '',
    funktion: a.funktion,
    avatar_url: a.avatar_path ? (bilder.get(a.avatar_path) ?? null) : null,
  }));

  const suppliers = supplierZeilen.map((z) => ({
    id: z.id,
    name: z.name ?? '',
    firma: z.firma ?? '',
    gewerk: z.gewerk ?? '',
    avatar_url: z.avatar_path ? (bilder.get(z.avatar_path) ?? null) : null,
  })) as unknown as Supplier[];

  return ok({ aufgaben, admins, suppliers });
});
