import { initials } from '@/lib/format';

/**
 * Runder Kreis mit Profilbild – oder mit den Initialen, solange keines
 * hinterlegt ist. Ersetzt den bisherigen Initialen-Kreis überall dort, wo
 * Personen auftauchen.
 */
export default function Avatar({
  url,
  name,
  size = 36,
  muted = false,
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
  muted?: boolean;
}) {
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.38)),
    ...(muted && !url ? { background: 'var(--ink-faint)' } : {}),
  };

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="avatar avatar-img"
        src={url}
        alt={name ?? ''}
        style={style}
        loading="lazy"
      />
    );
  }

  return (
    <div className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </div>
  );
}
