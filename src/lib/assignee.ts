import { INTERNAL_PARTY } from '@/lib/branding';
import { supplierLabel } from '@/lib/format';
import type { AdminProfile, Supplier } from '@/types';

/**
 * Eine Aufgabe kann drei Arten von Zuständigen haben. Der Wert in
 * todos.assigned_to trägt deshalb ein Präfix:
 *
 *   'internal'        – Swiss Solar Ventures AG allgemein
 *   'admin:<uuid>'    – eine bestimmte Person der Swiss Solar Ventures AG
 *   'supplier:<uuid>' – ein Lieferant
 *
 * Altbestand ohne Präfix wird als Lieferant gelesen; Migration 0002 schreibt ihn
 * einmalig um, diese Nachsicht ist nur ein Sicherheitsnetz.
 */
export const INTERNAL = 'internal';

export type Assignee =
  | { kind: 'internal' }
  | { kind: 'admin'; id: string }
  | { kind: 'supplier'; id: string };

export function parseAssignee(value: string | null | undefined): Assignee {
  const raw = (value ?? INTERNAL).trim();
  if (!raw || raw === INTERNAL) return { kind: 'internal' };
  if (raw.startsWith('admin:')) return { kind: 'admin', id: raw.slice(6) };
  if (raw.startsWith('supplier:')) return { kind: 'supplier', id: raw.slice(9) };
  return { kind: 'supplier', id: raw };
}

export const adminAssignee = (userId: string) => `admin:${userId}`;
export const supplierAssignee = (supplierId: string) => `supplier:${supplierId}`;

/** Anzeigename inklusive Funktion, z.B. „Dominic Maag · Projektmanagement“. */
export function assigneeLabel(
  value: string | null | undefined,
  admins: AdminProfile[],
  suppliers: Supplier[],
): string {
  const assignee = parseAssignee(value);

  if (assignee.kind === 'internal') return INTERNAL_PARTY;

  if (assignee.kind === 'admin') {
    // Bewusst nur der Name: die Funktion (CEO, Projektmanagement …) macht die
    // Zuweisung lang, ohne etwas beizutragen. Sie steht im Profil.
    const admin = admins.find((a) => a.user_id === assignee.id);
    return admin ? admin.name : INTERNAL_PARTY;
  }

  const supplier = suppliers.find((s) => s.id === assignee.id);
  return supplier ? supplierLabel(supplier) : 'Unbekannt';
}
