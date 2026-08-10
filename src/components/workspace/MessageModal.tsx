'use client';

import { useEffect, useRef } from 'react';
import { useFeedback } from '@/components/Feedback';

export type MessageDraft = {
  title: string;
  reason?: string;
  email: string;
  subject: string;
  body: string;
  mailtoUrl?: string;
};

/**
 * Rückfalloption, wenn der automatische Mailversand nicht greift: fertiger Text zum
 * Kopieren plus echter mailto-Link. Der Text wird beim Anklicken komplett markiert.
 */
export default function MessageModal({
  draft,
  onClose,
}: {
  draft: MessageDraft;
  onClose: () => void;
}) {
  const { toast } = useFeedback();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const fullText = `An: ${draft.email || '(keine E-Mail hinterlegt – bitte manuell eintragen)'}\nBetreff: ${draft.subject}\n\n${draft.body}`;

  useEffect(() => {
    areaRef.current?.focus();
    areaRef.current?.select();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText);
      toast('📋 Text kopiert.');
    } catch {
      toast('⚠️ Kopieren blockiert – Text oben markieren und manuell kopieren.', 'error');
    }
  }

  const mailto =
    draft.mailtoUrl ??
    `mailto:${encodeURIComponent(draft.email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 560 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          <h3 style={{ fontSize: 18 }}>{draft.title}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {draft.reason && <p className="auth-error">{draft.reason}</p>}

        <p style={{ marginBottom: 12 }}>
          Empfänger: <strong>{draft.email || 'noch keine Adresse hinterlegt'}</strong>
        </p>

        <textarea
          ref={areaRef}
          readOnly
          rows={11}
          value={fullText}
          onClick={(e) => e.currentTarget.select()}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            width: '100%',
            padding: 12,
            border: '1px solid var(--line)',
            borderRadius: 8,
            fontSize: 12.5,
            fontFamily: 'inherit',
            lineHeight: 1.5,
            resize: 'vertical',
            background: 'var(--bg)',
            color: 'var(--ink)',
          }}
        />

        <div className="form-actions" style={{ flexWrap: 'wrap', marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-accent"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={copy}
          >
            📋 Text kopieren
          </button>
          <a className="btn btn-ghost" href={mailto} style={{ textDecoration: 'none' }}>
            ✉️ Mail-App öffnen
          </a>
        </div>
      </div>
    </div>
  );
}
