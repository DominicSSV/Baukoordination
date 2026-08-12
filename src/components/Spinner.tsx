/**
 * Ladeanzeige: das Haus-Zeichen aus dem SSV-Logo dreht sich, statt einer Sanduhr.
 *
 * Das Zeichen liegt auf quadratischer Leinwand, damit die Drehung um die Bildmitte
 * läuft und nicht eiert.
 */
export default function Spinner({
  size = 44,
  label,
}: {
  size?: number;
  label?: string;
}) {
  return (
    <span className="loader" role="status" aria-label={label ?? 'Lädt'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="loader-mark"
        src="/logo-mark.png"
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
      />
      {label ? <span className="loader-label">{label}</span> : null}
    </span>
  );
}
