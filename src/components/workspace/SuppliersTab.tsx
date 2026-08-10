'use client';

import { useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import type { MessageDraft } from '@/components/workspace/MessageModal';
import { del, patch, post } from '@/lib/client/api';
import { initials, supplierLabel } from '@/lib/format';
import type { ProjectDetail, Supplier } from '@/types';

type InviteResponse = {
  sent: boolean;
  reason?: string;
  email: string;
  subject: string;
  body: string;
  mailtoUrl: string;
};

type Draft = {
  firma: string;
  name: string;
  gewerk: string;
  kontakt: string;
  email: string;
};

const emptyDraft: Draft = { firma: '', name: '', gewerk: '', kontakt: '', email: '' };

export default function SuppliersTab({
  detail,
  reload,
  onMessage,
  mailEnabled,
}: {
  detail: ProjectDetail;
  reload: () => Promise<void>;
  onMessage: (draft: MessageDraft) => void;
  mailEnabled: boolean;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [newSupplier, setNewSupplier] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  const projectId = detail.project.id;

  function startEdit(s: Supplier) {
    setEditingId(s.id);
    setDraft({
      firma: s.firma ?? '',
      name: s.name ?? '',
      gewerk: s.gewerk ?? '',
      kontakt: s.kontakt ?? '',
      email: s.email ?? '',
    });
  }

  async function run(action: () => Promise<void>, fallback: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      reportError(error, fallback);
    } finally {
      setBusy(false);
    }
  }

  const saveEdit = (id: string) =>
    run(async () => {
      if (!draft.firma.trim() && !draft.name.trim()) {
        throw new Error('Bitte mindestens Firma oder Ansprechperson angeben.');
      }
      await patch(`/api/suppliers/${id}`, draft);
      setEditingId(null);
      await reload();
      toast('✓ Lieferant gespeichert.');
    }, 'Speichern fehlgeschlagen.');

  const addSupplier = () =>
    run(async () => {
      if (!newSupplier.firma.trim() && !newSupplier.name.trim()) {
        throw new Error('Bitte mindestens Firma oder Ansprechperson angeben.');
      }
      await post('/api/suppliers', { ...newSupplier, projectId });
      setNewSupplier(emptyDraft);
      await reload();
      toast('✓ Lieferant angelegt und für dieses Projekt freigegeben.');
    }, 'Lieferant konnte nicht angelegt werden.');

  const setAccess = (supplierId: string, grant: boolean) =>
    run(async () => {
      await post(`/api/projects/${projectId}/access`, { supplierId, grant });
      await reload();
      toast(grant ? '✓ Zugriff erteilt.' : '✓ Zugriff für dieses Projekt entzogen.');
    }, 'Zugriffsrechte konnten nicht geändert werden.');

  function deleteSupplier(s: Supplier) {
    confirm(
      `„${supplierLabel(s)}“ wirklich komplett löschen?\n\nDer Zugangscode wird ungültig und der Zugriff auf ALLE Projekte geht verloren – nicht nur auf das aktuelle.`,
      async () => {
        await del(`/api/suppliers/${s.id}`);
        await reload();
        toast(`🗑️ „${supplierLabel(s)}“ gelöscht.`);
      },
    );
  }

  const invite = (s: Supplier) =>
    run(async () => {
      const result = await post<InviteResponse>(`/api/suppliers/${s.id}/invite`, {
        projectId,
      });

      if (result.sent) {
        toast(`✉️ Einladung an ${result.email} verschickt.`);
        return;
      }

      // Kein automatischer Versand möglich: Text zum Kopieren und mailto-Link anbieten,
      // statt die Aktion wortlos scheitern zu lassen.
      onMessage({
        title: 'Einladung versenden',
        reason: result.reason,
        email: result.email,
        subject: result.subject,
        body: result.body,
        mailtoUrl: result.mailtoUrl,
      });
    }, 'Einladung konnte nicht verschickt werden.');

  const copyCode = (s: Supplier) =>
    run(async () => {
      const code = s.access_code ?? '';
      try {
        await navigator.clipboard.writeText(code);
        toast(`📋 Code kopiert: ${code}`);
      } catch {
        toast(`⚠️ Kopieren blockiert – der Code lautet: ${code}`, 'error');
      }
    }, 'Code konnte nicht kopiert werden.');

  function editForm(s: Supplier) {
    return (
      <div key={s.id} className="supplier-row supplier-row-editing">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="add-form-grid cols-2" style={{ marginTop: 0 }}>
            <input
              type="text"
              value={draft.firma}
              onChange={(e) => setDraft({ ...draft, firma: e.target.value })}
              placeholder="Firma"
            />
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Ansprechperson (Name)"
            />
            <input
              type="text"
              value={draft.gewerk}
              onChange={(e) => setDraft({ ...draft, gewerk: e.target.value })}
              placeholder="Gewerk"
            />
            <input
              type="text"
              value={draft.kontakt}
              onChange={(e) => setDraft({ ...draft, kontakt: e.target.value })}
              placeholder="Telefon"
            />
          </div>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="E-Mail"
            style={{
              width: '100%',
              marginTop: 8,
              padding: '9px 11px',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontSize: 13.5,
            }}
          />
          <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '8px 0 0' }}>
            Der Zugangscode bleibt beim Bearbeiten unverändert – bereits verschickte
            Einladungen funktionieren weiter.
          </p>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => saveEdit(s.id)}
              disabled={busy}
            >
              Speichern
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditingId(null)}
              disabled={busy}
            >
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    );
  }

  function displayMeta(s: Supplier) {
    const parts = [
      s.firma && s.name ? s.firma : null,
      s.gewerk || 'Gewerk n/a',
      s.kontakt || null,
    ].filter(Boolean);
    return parts.join(' · ');
  }

  return (
    <>
      <div className="card">
        <div className="section-head">
          <h2>Lieferanten mit Zugriff auf dieses Projekt</h2>
        </div>

        {!mailEnabled && (
          <div className="info-banner" style={{ marginBottom: 14 }}>
            ✉️ Automatischer Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt).
            Einladungen erzeugen weiterhin einen fertigen Text zum Kopieren bzw. einen
            mailto-Link.
          </div>
        )}

        {detail.suppliers.length ? (
          detail.suppliers.map((s) =>
            editingId === s.id ? (
              editForm(s)
            ) : (
              <div key={s.id} className="supplier-row">
                <div className="avatar">{initials(s.name || s.firma)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="supplier-name">{supplierLabel(s)}</div>
                  <div className="supplier-meta">{displayMeta(s)}</div>
                  <div className="supplier-meta">
                    Code:{' '}
                    <strong style={{ letterSpacing: '0.06em' }}>
                      {s.access_code ?? '—'}
                    </strong>
                    {s.email ? ` · ${s.email}` : ' · keine E-Mail hinterlegt'}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => startEdit(s)}
                  title="Bearbeiten"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyCode(s)}
                  title="Code kopieren"
                >
                  📋 Code
                </button>
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={() => invite(s)}
                  disabled={busy}
                  title="Einladung per E-Mail senden"
                >
                  ✉️ Einladen
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setAccess(s.id, false)}
                  title="Zugriff nur für dieses Projekt entziehen"
                >
                  ✕
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => deleteSupplier(s)}
                  title="Lieferant komplett löschen (alle Projekte)"
                >
                  🗑️
                </button>
              </div>
            ),
          )
        ) : (
          <div className="empty-state" style={{ padding: '24px 10px' }}>
            <p>Noch keine Lieferanten für dieses Projekt freigegeben.</p>
          </div>
        )}

        <div className="add-form-grid cols-2" style={{ marginTop: 14 }}>
          <input
            type="text"
            value={newSupplier.firma}
            onChange={(e) => setNewSupplier({ ...newSupplier, firma: e.target.value })}
            placeholder="Firma (neu)"
          />
          <input
            type="text"
            value={newSupplier.name}
            onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
            placeholder="Ansprechperson (Name)"
          />
        </div>
        <div className="add-form-grid">
          <input
            type="text"
            value={newSupplier.gewerk}
            onChange={(e) => setNewSupplier({ ...newSupplier, gewerk: e.target.value })}
            placeholder="Gewerk (z.B. Elektro)"
          />
          <input
            type="text"
            value={newSupplier.kontakt}
            onChange={(e) => setNewSupplier({ ...newSupplier, kontakt: e.target.value })}
            placeholder="Telefon"
          />
          <input
            type="email"
            value={newSupplier.email}
            onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
            placeholder="E-Mail für Einladung"
          />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={addSupplier}
            disabled={busy}
          >
            + Neu &amp; freigeben
          </button>
        </div>
      </div>

      {detail.otherSuppliers.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-head">
            <h2>Weitere Lieferanten (kein Zugriff auf dieses Projekt)</h2>
          </div>
          {detail.otherSuppliers.map((s) =>
            editingId === s.id ? (
              editForm(s)
            ) : (
              <div key={s.id} className="supplier-row">
                <div className="avatar" style={{ background: 'var(--ink-faint)' }}>
                  {initials(s.name || s.firma)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="supplier-name">{supplierLabel(s)}</div>
                  <div className="supplier-meta">{displayMeta(s)}</div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => startEdit(s)}
                  title="Bearbeiten"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAccess(s.id, true)}
                  disabled={busy}
                >
                  + Zugriff geben
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => deleteSupplier(s)}
                  title="Lieferant komplett löschen (alle Projekte)"
                >
                  🗑️
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}
