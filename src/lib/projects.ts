import 'server-only';
import { STORAGE_BUCKET } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';
import { signAvatars } from '@/lib/avatars';
import type { Ctx } from '@/lib/auth/guards';

import type {
  ActivityEntry,
  AdminProfile,
  FileComment,
  Project,
  ProjectDetail,
  ProjectFile,
  ScheduleNote,
  ScheduleTask,
  Supplier,
  Todo,
  TodoComment,
} from '@/types';

/** Gültigkeit der Signed URLs für Vorschau und Download. */
const SIGNED_URL_TTL = 60 * 60;

/**
 * Die Bauherrenvertreter, denen eine Aufgabe zugewiesen werden kann.
 *
 * Bewusst über service_role und mit fester Spaltenauswahl: die Liste muss auch ein
 * Lieferant sehen, und sie darf keine E-Mail-Adressen enthalten. Über RLS ginge das
 * nur mit der View admin_public aus Migration 0002 – die Namensliste wäre dann aber
 * leer, solange diese Migration nicht eingespielt ist, und niemand könnte jemandem
 * etwas zuweisen. Die Spalten firma und funktion kommen ebenfalls erst mit 0002,
 * daher der zweite, schlankere Versuch.
 */
async function loadAdminProfiles(): Promise<AdminProfile[]> {
  const db = serviceClient();

  const full = await db
    .from('admins')
    .select('user_id, name, firma, funktion, avatar_path')
    .order('name', { ascending: true });

  if (!full.error) {
    const rows = (full.data ?? []) as Array<AdminProfile & { avatar_path: string | null }>;
    const urls = await signAvatars(rows.map((r) => r.avatar_path));
    return rows.map((r) => ({
      user_id: r.user_id,
      name: r.name,
      firma: r.firma,
      funktion: r.funktion,
      avatar_url: r.avatar_path ? (urls.get(r.avatar_path) ?? null) : null,
    }));
  }

  // Ohne Migration 0005 gibt es die Bildspalte noch nicht.
  const ohneBild = await db
    .from('admins')
    .select('user_id, name, firma, funktion')
    .order('name', { ascending: true });

  if (!ohneBild.error) return (ohneBild.data ?? []) as AdminProfile[];

  const basic = await db
    .from('admins')
    .select('user_id, name')
    .order('name', { ascending: true });

  if (basic.error) {
    console.warn('[projects] Bauherrenvertreter nicht ladbar', basic.error.message);
    return [];
  }

  return (basic.data ?? []).map((a: { user_id: string; name: string | null }) => ({
    user_id: a.user_id,
    name: a.name?.trim() || 'Bauherrenvertreter',
    firma: 'Swiss Solar Ventures AG',
    funktion: null,
  }));
}

/** Projekte, die der Aufrufer sehen darf. Für Lieferanten filtert bereits die RLS. */
export async function listProjects(ctx: Ctx): Promise<Project[]> {
  const mitStatus = await ctx.db
    .from('projects')
    .select('id, name, ort, created_at, status, order_index')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  // status/order_index kommen erst mit Migration 0009.
  const res = mitStatus.error
    ? await ctx.db
        .from('projects')
        .select('id, name, ort, created_at')
        .order('created_at', { ascending: true })
    : mitStatus;

  if (res.error) {
    throw new Error(`Projekte konnten nicht geladen werden: ${res.error.message}`);
  }
  return (res.data ?? []) as Project[];
}

async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return map;

  const { data, error } = await serviceClient()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL);

  if (error) {
    console.error('[storage] Signed URLs fehlgeschlagen', error);
    return map;
  }

  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

/**
 * Lädt alles, was ein Projekt-Tab anzeigt, in einem Rutsch: To-Dos samt Kommentaren,
 * Dateien mit Vorschau-Links, Protokoll und Zugriffsliste.
 */
export async function loadProjectDetail(
  ctx: Ctx,
  projectId: string,
): Promise<ProjectDetail> {
  const db = ctx.db;
  const isAdmin = ctx.session.kind === 'admin';

  const projektMitPlan = await db
    .from('projects')
    .select('id, name, ort, created_at, schedule_start, schedule_end')
    .eq('id', projectId)
    .maybeSingle();

  // schedule_start/-end kommen erst mit Migration 0006.
  const projektRes = projektMitPlan.error
    ? await db
        .from('projects')
        .select('id, name, ort, created_at')
        .eq('id', projectId)
        .maybeSingle()
    : projektMitPlan;

  if (projektRes.error) throw new Error(`Projekt: ${projektRes.error.message}`);
  if (!projektRes.data) throw new Error('Projekt nicht gefunden.');

  const project = projektRes.data as Project;

  const [todosRes, filesRes, activityRes, accessRes] = await Promise.all([
    db
      .from('todos')
      .select(
        'id, project_id, text, assigned_to, assignees, vertraulich, done, done_by, done_at, created_by, created_by_supplier_id, created_at, edited_at, order_index, due_date',
      )
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('files')
      .select(
        'id, project_id, todo_id, name, mime_type, size_bytes, storage_path, thumb_path, uploaded_by, uploaded_by_supplier_id, uploaded_at, offer_folder, offer_amount, offer_status',
      )
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('uploaded_at', { ascending: false }),
    db
      .from('activity')
      .select('id, project_id, actor_name, text, icon, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(150),
    db.from('project_access').select('supplier_id').eq('project_id', projectId),
  ]);

  // Ohne Migration 0014 gibt es die Spalte mit mehreren Zuständigen noch nicht.
  const aufgaben = todosRes.error
    ? await db
        .from('todos')
        .select(
          'id, project_id, text, assigned_to, done, done_by, done_at, created_by, created_by_supplier_id, created_at, edited_at, order_index, due_date',
        )
        .eq('project_id', projectId)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: true })
    : todosRes;

  if (aufgaben.error) throw new Error(`To-Dos: ${aufgaben.error.message}`);

  // Ohne Migration 0012 gibt es die Ordnerspalte noch nicht – dann eben ohne.
  const dateien = filesRes.error
    ? await db
        .from('files')
        .select(
          'id, project_id, todo_id, name, mime_type, size_bytes, storage_path, thumb_path, uploaded_by, uploaded_by_supplier_id, uploaded_at',
        )
        .eq('project_id', projectId)
        .order('uploaded_at', { ascending: false })
    : filesRes;

  if (dateien.error) throw new Error(`Dateien: ${dateien.error.message}`);
  if (activityRes.error) throw new Error(`Aktivität: ${activityRes.error.message}`);
  if (accessRes.error) throw new Error(`Zugriffsrechte: ${accessRes.error.message}`);

  const todoRows = (aufgaben.data ?? []) as Array<
    Omit<Todo, 'comments' | 'assignees' | 'vertraulich'> & {
      assignees?: string[] | null;
      vertraulich?: boolean | null;
    }
  >;

  const commentsRes = todoRows.length
    ? await db
        .from('todo_comments')
        .select('id, todo_id, text, author, author_supplier_id, created_at')
        .in(
          'todo_id',
          todoRows.map((t) => t.id),
        )
        .order('created_at', { ascending: true })
    : { data: [] as TodoComment[], error: null };

  if (commentsRes.error) throw new Error(`Kommentare: ${commentsRes.error.message}`);

  const commentsByTodo = new Map<string, TodoComment[]>();
  for (const c of (commentsRes.data ?? []) as TodoComment[]) {
    const list = commentsByTodo.get(c.todo_id) ?? [];
    list.push(c);
    commentsByTodo.set(c.todo_id, list);
  }

  const todos: Todo[] = todoRows.map((t) => ({
    ...t,
    // Ohne Migration 0014 zählt der eine bisherige Zuständige.
    assignees: t.assignees?.length ? t.assignees : [t.assigned_to],
    vertraulich: Boolean(t.vertraulich),
    comments: commentsByTodo.get(t.id) ?? [],
  }));

  const fileRows = (dateien.data ?? []) as Array<
    ProjectFile & { storage_path: string; thumb_path: string | null }
  >;

  // Bilder zeigen die verkleinerte Vorschau, alles andere bekommt keine.
  const urls = await signedUrls(
    fileRows
      .filter((f) => (f.mime_type ?? '').startsWith('image/'))
      .map((f) => f.thumb_path ?? f.storage_path),
  );

  // Anmerkungen zu den Dateien. Ohne Migration 0016 gibt es die Tabelle noch
  // nicht – dann bleiben die Listen eben leer.
  const kommentare = fileRows.length
    ? await db
        .from('file_comments')
        .select('id, file_id, text, author, author_supplier_id, created_at')
        .in(
          'file_id',
          fileRows.map((f) => f.id),
        )
        .order('created_at', { ascending: true })
    : { data: [] as FileComment[], error: null };

  const kommentareNachDatei = new Map<string, FileComment[]>();
  for (const c of (kommentare.data ?? []) as FileComment[]) {
    const liste = kommentareNachDatei.get(c.file_id) ?? [];
    liste.push(c);
    kommentareNachDatei.set(c.file_id, liste);
  }

  const files: ProjectFile[] = fileRows.map((f) => ({
    id: f.id,
    project_id: f.project_id,
    todo_id: f.todo_id,
    name: f.name,
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    uploaded_by: f.uploaded_by,
    uploaded_by_supplier_id: f.uploaded_by_supplier_id,
    uploaded_at: f.uploaded_at,
    offer_folder: f.offer_folder ?? null,
    offer_amount: f.offer_amount ?? null,
    offer_status: f.offer_status ?? null,
    comments: kommentareNachDatei.get(f.id) ?? [],
    thumb_url: urls.get(f.thumb_path ?? f.storage_path) ?? null,
    can_delete:
      isAdmin ||
      (f.uploaded_by_supplier_id !== null &&
        ctx.session.kind === 'supplier' &&
        f.uploaded_by_supplier_id === ctx.session.supplierId),
  }));

  const accessIds = (accessRes.data ?? []).map(
    (r: { supplier_id: string }) => r.supplier_id,
  );

  // Der Admin sieht die volle Kartei inkl. Zugangscodes, ein Lieferant nur Namen
  // (View supplier_public liefert weder Code noch Kontaktdaten anderer Lieferanten).
  let suppliers: Supplier[] = [];
  let otherSuppliers: Supplier[] = [];

  if (isAdmin) {
    const mitBild = await db
      .from('suppliers')
      .select(
        'id, name, firma, gewerk, kontakt, email, access_code, created_at, avatar_path',
      )
      .order('created_at', { ascending: true });

    // Ohne Migration 0005 fehlt die Bildspalte – dann eben ohne Bilder weiter.
    const res = mitBild.error
      ? await db
          .from('suppliers')
          .select('id, name, firma, gewerk, kontakt, email, access_code, created_at')
          .order('created_at', { ascending: true })
      : mitBild;

    if (res.error) throw new Error(`Lieferanten: ${res.error.message}`);

    const rows = (res.data ?? []) as Array<Supplier & { avatar_path?: string | null }>;
    const urls = await signAvatars(rows.map((r) => r.avatar_path));

    const all: Supplier[] = rows.map((r) => ({
      ...r,
      avatar_url: r.avatar_path ? (urls.get(r.avatar_path) ?? null) : null,
    }));

    suppliers = all.filter((s) => accessIds.includes(s.id));
    otherSuppliers = all.filter((s) => !accessIds.includes(s.id));
  } else {
    // Die View liefert einem Lieferanten genau die Kollegen, mit denen er sich ein
    // Projekt teilt – ohne Zugangscode und ohne Kontaktdaten. Hier wird bewusst NICHT
    // nach accessIds gefiltert: die RLS lässt einen Lieferanten in project_access nur
    // die eigene Zeile sehen, sonst bliebe der Name eines fremden Zuständigen leer.
    const mitBild = await db
      .from('supplier_public')
      .select('id, name, firma, gewerk, avatar_path');

    const res = mitBild.error
      ? await db.from('supplier_public').select('id, name, firma, gewerk')
      : mitBild;

    if (res.error) throw new Error(`Lieferanten: ${res.error.message}`);

    const rows = (res.data ?? []) as Array<
      Pick<Supplier, 'id' | 'name' | 'firma' | 'gewerk'> & { avatar_path?: string | null }
    >;
    const urls = await signAvatars(rows.map((r) => r.avatar_path));

    suppliers = rows.map((s) => ({
      id: s.id,
      name: s.name,
      firma: s.firma,
      gewerk: s.gewerk,
      kontakt: null,
      email: null,
      avatar_url: s.avatar_path ? (urls.get(s.avatar_path) ?? null) : null,
    }));
  }

  const admins = await loadAdminProfiles();

  // Der Terminplan darf fehlen, solange Migration 0006 nicht eingespielt ist.
  const planRes = await db
    .from('schedule_tasks')
    .select('id, project_id, responsible, owner, label, start_date, end_date, color, order_index')
    .eq('project_id', projectId)
    .order('order_index', { ascending: true })
    .order('start_date', { ascending: true });

  if (planRes.error) {
    console.warn('[projects] Terminplan nicht verfügbar', planRes.error.message);
  }

  const planZeilen = (planRes.error ? [] : (planRes.data ?? [])) as Array<
    Omit<ScheduleTask, 'notes'>
  >;

  // Rückmeldungen der Lieferanten. Fehlt die Tabelle (Migration 0010), bleibt
  // der Plan ohne Anmerkungen nutzbar.
  const notizenRes = planZeilen.length
    ? await db
        .from('schedule_notes')
        .select(
          'id, task_id, text, author, author_supplier_id, vorschlag_start, vorschlag_ende, status, created_at',
        )
        .in('task_id', planZeilen.map((t) => t.id))
        .order('created_at', { ascending: true })
    : { data: [], error: null };

  if (notizenRes.error) {
    console.warn('[projects] Rückmeldungen nicht verfügbar', notizenRes.error.message);
  }

  const notizenJeArbeit = new Map<string, ScheduleNote[]>();
  for (const n of (notizenRes.error ? [] : (notizenRes.data ?? [])) as ScheduleNote[]) {
    const liste = notizenJeArbeit.get(n.task_id) ?? [];
    liste.push(n);
    notizenJeArbeit.set(n.task_id, liste);
  }

  return {
    project,
    todos,
    files,
    activity: (activityRes.data ?? []) as ActivityEntry[],
    accessIds,
    suppliers,
    otherSuppliers,
    admins,
    schedule: planZeilen.map((t) => ({
      ...t,
      notes: notizenJeArbeit.get(t.id) ?? [],
    })),
  };
}
