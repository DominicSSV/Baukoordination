/**
 * Ladeanzeige: das Haus-Zeichen aus dem SSV-Logo dreht sich, statt einer Sanduhr.
 *
 * Verwendet wird logo-loader.png – dieselbe Zeichnung, aber so auf die Leinwand
 * gesetzt, dass ihr Schwerpunkt genau in der Bildmitte liegt und alles in den
 * einbeschriebenen Kreis passt. Mit der Originaldatei sass der Schwerpunkt
 * unterhalb der Mitte; das Zeichen kreiste dann sichtbar, statt sich zu drehen.
 */
export default function Spinner({
  size = 44,
  label,
}: {
  size?: number;
  label?: string;
}) {
  // Die Leinwand ist grösser als das Zeichen, damit beim Drehen nichts anstösst.
  // Diesen Rand rechnen wir wieder heraus, damit das Haus so gross erscheint wie
  // bisher – sonst wirkte die Ladeanzeige plötzlich geschrumpft.
  const kante = Math.round(size * 1.34);

  return (
    <span className="loader" role="status" aria-label={label ?? 'Lädt'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="loader-mark"
        src="/logo-loader.png"
        alt=""
        width={kante}
        height={kante}
        aria-hidden="true"
      />
      {label ? <span className="loader-label">{label}</span> : null}
    </span>
  );
}
