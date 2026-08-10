import 'server-only';
import { STORAGE_BUCKET } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';
import type { Ctx } from '@/lib/auth/guards';
import { unwrap } from '@/lib/api';
import type {
  ActivityEntry,
  Project,
  ProjectDetail,
  ProjectFile,
  Supplier,
  Todo,
  TodoComment,
} from '@/types';

/** Gültigkeit der Signed URLs für Vorschau und Download. */
const SIGNED_URL_TTL = 60 * 60;

/** Projekte, die der Aufrufer sehen darf. Für Lieferanten filtert bereits die RLS. */
export async function listProjects(ctx: Ctx): Promise<Project[]> {
  const { data, error } = await ctx.db
    .from('projects')
    .select('id, name, ort, created_at')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Projekte konnten nicht geladen werden: ${error.message}`);
  return (data ?? []) as Project[];
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

  const project = unwrap(
    await db
      .from('projects')
      .select('id, name, ort, created_at')
      .eq('id', projectId)
      .maybeSingle(),
    'Projekt',
  ) as Project;

  const [todosRes, filesRes, activityRes, accessRes] = await Promise.all([
    db
      .from('todos')
      .select(
        'id, project_id, text, assigned_to, done, done_by, done_at, created_by, created_by_supplier_id, created_at, edited_at, order_index',
      )
      .eq('project_id', projectId)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('files')
      .select(
        'id, project_id, todo_id, name, mime_type, size_bytes, storage_path, thumb_path, uploaded_by, uploaded_by_supplier_id, uploaded_at',
      )
      .eq('project_id', projectId)
      .order('uploaded_at', { ascending: false }),
    db
      .from('activity')
      .select('id, project_id, actor_name, text, icon, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(150),
    db.from('project_access').select('supplier_id').eq('project_id', projectId),
  ]);

  if (todosRes.error) throw new Error(`To-Dos: ${todosRes.error.message}`);
  if (filesRes.error) throw new Error(`Dateien: ${filesRes.error.message}`);
  if (activityRes.error) throw new Error(`Aktivität: ${activityRes.error.message}`);
  if (accessRes.error) throw new Error(`Zugriffsrechte: ${accessRes.error.message}`);

  const todoRows = (todosRes.data ?? []) as Omit<Todo, 'comments'>[];

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
    comments: commentsByTodo.get(t.id) ?? [],
  }));

  const fileRows = (filesRes.data ?? []) as Array<
    ProjectFile & { storage_path: string; thumb_path: string | null }
  >;

  // Bilder zeigen die verkleinerte Vorschau, alles andere bekommt keine.
  const urls = await signedUrls(
    fileRows
      .filter((f) => (f.mime_type ?? '').startsWith('image/'))
      .map((f) => f.thumb_path ?? f.storage_path),
  );

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
    const { data, error } = await db
      .from('suppliers')
      .select('id, name, firma, gewerk, kontakt, email, access_code, created_at')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Lieferanten: ${error.message}`);

    const all = (data ?? []) as Supplier[];
    suppliers = all.filter((s) => accessIds.includes(s.id));
    otherSuppliers = all.filter((s) => !accessIds.includes(s.id));
  } else {
    // Die View liefert einem Lieferanten genau die Kollegen, mit denen er sich ein
    // Projekt teilt – ohne Zugangscode und ohne Kontaktdaten. Hier wird bewusst NICHT
    // nach accessIds gefiltert: die RLS lässt einen Lieferanten in project_access nur
    // die eigene Zeile sehen, sonst bliebe der Name eines fremden Zuständigen leer.
    const { data, error } = await db
      .from('supplier_public')
      .select('id, name, firma, gewerk');
    if (error) throw new Error(`Lieferanten: ${error.message}`);

    suppliers = (
      (data ?? []) as Array<Pick<Supplier, 'id' | 'name' | 'firma' | 'gewerk'>>
    ).map((s) => ({ ...s, kontakt: null, email: null }));
  }

  return {
    project,
    todos,
    files,
    activity: (activityRes.data ?? []) as ActivityEntry[],
    accessIds,
    suppliers,
    otherSuppliers,
  };
}
