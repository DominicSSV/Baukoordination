/** Anzeige-Helfer, gleich wie im Prototyp. */

export function fmtDate(value: string | number | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return (
    d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
  );
}

export function fmtSize(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function initials(name: string | null | undefined): string {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function supplierLabel(
  s: { name?: string | null; firma?: string | null } | undefined | null,
): string {
  return s?.name?.trim() || s?.firma?.trim() || 'Unbekannt';
}
