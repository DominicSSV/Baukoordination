import 'server-only';
import { parseAssignee } from '@/lib/assignee';

/**
 * Welche Lieferanten eine Aufgabe etwas angeht.
 *
 * Genau diese Firmen sehen die Aufgabe (Migration 0014) – und damit auch die
 * Protokolleinträge dazu (Migration 0015). Kommt kein Lieferant vor, ist es
 * eine rein interne Aufgabe: die Liste bleibt leer und nur wir sehen den
 * Eintrag. Das ist etwas anderes als "keine Einschränkung", wofür der Aufrufer
 * den Wert weglässt.
 */
export function beteiligteLieferanten(todo: {
  assignees?: string[] | null;
  assigned_to?: string | null;
  created_by_supplier_id?: string | null;
}): string[] {
  const ids = new Set<string>();

  const liste = todo.assignees?.length
    ? todo.assignees
    : todo.assigned_to
      ? [todo.assigned_to]
      : [];

  for (const wert of liste) {
    const ziel = parseAssignee(wert);
    if (ziel.kind === 'supplier') ids.add(ziel.id);
  }

  if (todo.created_by_supplier_id) ids.add(todo.created_by_supplier_id);

  return Array.from(ids);
}
