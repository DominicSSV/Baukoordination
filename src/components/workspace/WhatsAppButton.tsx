'use client';

import { waLink } from '@/lib/whatsapp';

/**
 * Öffnet WhatsApp mit fertig geschriebener Nachricht.
 *
 * Bewusst ein <a> und kein Knopf mit onClick: So funktioniert "in neuem Tab
 * öffnen", und auf dem Handy übernimmt das Betriebssystem den Absprung in die
 * App, ohne dass ein Fenster aufgeht und gleich wieder zugeht.
 */
export default function WhatsAppButton({
  text,
  nummer,
  beschriftung = 'WhatsApp',
  titel,
  klasse = 'btn btn-ghost btn-sm',
}: {
  /** Der fertige Nachrichtentext. */
  text: string;
  /** Nummer im wa.me-Format, oder null für die Kontaktauswahl. */
  nummer?: string | null;
  beschriftung?: string;
  titel?: string;
  klasse?: string;
}) {
  return (
    <a
      className={`${klasse} wa-knopf`}
      href={waLink(text, nummer)}
      target="_blank"
      rel="noopener noreferrer"
      title={
        titel ??
        (nummer
          ? 'Nachricht in WhatsApp öffnen'
          : 'WhatsApp öffnen – Empfänger dort auswählen')
      }
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.17 1.73 2.65 4.2 3.71.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29z" />
      </svg>
      {beschriftung}
    </a>
  );
}
