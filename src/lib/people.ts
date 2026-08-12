import { parseAssignee } from '@/lib/assignee';
import { supplierLabel } from '@/lib/format';
import { INTERNAL_PARTY } from '@/lib/branding';
import type { AdminProfile, Supplier } from '@/types';

export type Person = {
  name: string;
  avatarUrl: string | null;
};

/**
 * Findet zu einer Person das Profilbild.
 *
 * Protokoll, Kommentare und Dateien halten den Urheber als Namen fest, teils mit
 * Lieferanten-ID. Über die ID ist die Zuordnung eindeutig; sonst wird über den
 * Namen gesucht. Das genügt, weil die Namen der Bauherrenvertreter fest
 * hinterlegt sind – nur wenn jemand später umbenannt wird, bleiben ältere
 * Einträge ohne Bild. Sie zeigen dann wie bisher die Initialen.
 */
export function findPerson(
  quelle: { admins: AdminProfile[]; suppliers: Supplier[] },
  gesucht: { name?: string | null; supplierId?: string | null },
): Person {
  const name = gesucht.name?.trim() ?? '';

  if (gesucht.supplierId) {
    const s = quelle.suppliers.find((x) => x.id === gesucht.supplierId);
    if (s) return { name: name || supplierLabel(s), avatarUrl: s.avatar_url ?? null };
  }

  if (!name) return { name: 'Unbekannt', avatarUrl: null };

  const klein = name.toLowerCase();

  const admin = quelle.admins.find((a) => a.name.trim().toLowerCase() === klein);
  if (admin) return { name, avatarUrl: admin.avatar_url ?? null };

  const supplier = quelle.suppliers.find(
    (s) => supplierLabel(s).toLowerCase() === klein,
  );
  if (supplier) return { name, avatarUrl: supplier.avatar_url ?? null };

  return { name, avatarUrl: null };
}

/** Zuständiger einer Aufgabe als Person – inklusive Bild und Funktion. */
export function assigneePerson(
  quelle: { admins: AdminProfile[]; suppliers: Supplier[] },
  assignedTo: string | null | undefined,
): Person & { funktion: string | null } {
  const ziel = parseAssignee(assignedTo);

  if (ziel.kind === 'admin') {
    const a = quelle.admins.find((x) => x.user_id === ziel.id);
    if (a) {
      return { name: a.name, avatarUrl: a.avatar_url ?? null, funktion: a.funktion };
    }
    return { name: INTERNAL_PARTY, avatarUrl: null, funktion: null };
  }

  if (ziel.kind === 'supplier') {
    const s = quelle.suppliers.find((x) => x.id === ziel.id);
    if (s) {
      return { name: supplierLabel(s), avatarUrl: s.avatar_url ?? null, funktion: null };
    }
    return { name: 'Unbekannt', avatarUrl: null, funktion: null };
  }

  return { name: INTERNAL_PARTY, avatarUrl: null, funktion: null };
}
