import 'server-only';
import { Resend } from 'resend';
import { appBaseUrl, mailFrom, mailReplyTo, resendApiKey } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';
import type { ActivityEntry, Project, Supplier } from '@/types';

function client(): Resend | null {
  const key = resendApiKey();
  return key ? new Resend(key) : null;
}

export function mailEnabled(): boolean {
  return Boolean(resendApiKey());
}

/**
 * Sofort-Benachrichtigung bei jeder Aktivität. Standardmässig an – so verlangt vom
 * Auftraggeber. Mit NOTIFY_ON_EVERY_ACTIVITY=false lässt sie sich abschalten, falls
 * die Menge an Post im Betrieb doch zu viel wird.
 */
function notifyOnEveryActivity(): boolean {
  return process.env.NOTIFY_ON_EVERY_ACTIVITY !== 'false';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rahmen im SSV-Look: Gelb→Grün-Verlauf als Akzentbalken, Poppins als Schrift. */
function wrapHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:24px;background:#F2F2F1;font-family:Poppins,Helvetica,Arial,sans-serif;color:#262624;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;background:#FFFFFF;border:1px solid #D9D9D9;border-radius:10px;overflow:hidden;">
    <tr>
      <td style="width:10px;background:linear-gradient(180deg,#FFBD59 0%,#00BF63 100%);"></td>
      <td style="padding:22px 24px;">
        <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#929291;">Baukoordination</div>
        <h1 style="font-size:20px;margin:4px 0 16px;color:#262624;">${escapeHtml(title)}</h1>
        ${bodyHtml}
        <p style="margin:22px 0 0;font-size:11.5px;color:#929291;border-top:1px solid #D9D9D9;padding-top:12px;">
          Swiss Solar Ventures AG · Diese Nachricht wurde automatisch aus der Baukoordination versendet.
        </p>
      </td>
    </tr>
  </table>
</body></html>`;
}

async function send(params: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** Setzt die Dringlichkeits-Kopfzeilen, die Outlook als rotes Ausrufezeichen zeigt. */
  dringend?: boolean;
}): Promise<void> {
  const resend = client();
  if (!resend) throw new Error('Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt).');
  if (!params.to.length) throw new Error('Keine Empfänger mit hinterlegter E-Mail-Adresse.');

  const antwortAn = mailReplyTo();

  const { error } = await resend.emails.send({
    from: mailFrom(),
    to: params.to,
    ...(antwortAn ? { replyTo: antwortAn } : {}),
    subject: params.subject,
    text: params.text,
    html: params.html,
    headers: params.dringend
      ? {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'high',
        }
      : undefined,
  });

  if (error) {
    throw new Error(`Mailversand fehlgeschlagen: ${error.message ?? String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Einladung
// ---------------------------------------------------------------------------

/** Nur der Vorname – die Anrede im Einladungstext ist bewusst persönlich gehalten. */
function firstName(supplier: Pick<Supplier, 'name' | 'firma'>): string {
  const full = supplier.name?.trim() || supplier.firma?.trim() || '';
  return full.split(/\s+/)[0] || 'zusammen';
}

export function buildInvite(supplier: Supplier) {
  const link = appBaseUrl();
  const code = supplier.access_code ?? '';
  const subject = 'Zugriff auf Baukoordination-App / Swiss Solar Ventures AG';

  // Wortlaut wie von der Swiss Solar Ventures AG vorgegeben. Bewusst ohne
  // Grussformel: die Signatur hängt das Mailprogramm selbst an.
  const body = [
    `Ciao ${firstName(supplier)}`,
    ``,
    `Du hast nun Zugriff auf unsere Baukoordination-App!`,
    ``,
    `So meldest du dich an:`,
    `1. Link öffnen: ${link}`,
    `2. Im Feld, das sich direkt öffnet, diesen Zugangscode eingeben: ${code}`,
    ``,
    `Dann siehst du die Projekte welche dir zugeordnet sind.`,
    `Du kannst dort To-Dos erstellen, diese abhaken, kommentieren sowie Fotos und Dokumente hinzufügen.`,
    ``,
    `Viel Spass beim ausprobieren ;)`,
    ``,
    `Bitte gib uns Bescheid wenn du Verbesserungsvorschläge hast oder einen Fehler entdeckst.`,
  ].join('\n');

  const html = wrapHtml('Zugriff auf die Baukoordination-App', `
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">Ciao ${escapeHtml(firstName(supplier))}</p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 18px;">
      Du hast nun Zugriff auf unsere Baukoordination-App!
    </p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 8px;">Dein persönlicher Zugangscode:</p>
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;letter-spacing:0.14em;color:#00BF63;background:#DFF6E9;border-radius:8px;padding:14px 18px;text-align:center;margin:0 0 18px;">
      ${escapeHtml(code)}
    </div>
    <p style="margin:0 0 18px;">
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#00BF63;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">App öffnen und Code eingeben</a>
    </p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
      Dann siehst du die Projekte welche dir zugeordnet sind.<br />
      Du kannst dort To-Dos erstellen, diese abhaken, kommentieren sowie Fotos und Dokumente hinzufügen.
    </p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">Viel Spass beim ausprobieren ;)</p>
    <p style="font-size:13px;line-height:1.6;color:#6B6B69;margin:0;">
      Bitte gib uns Bescheid wenn du Verbesserungsvorschläge hast oder einen Fehler entdeckst.
    </p>
  `);

  const mailtoUrl = `mailto:${encodeURIComponent(supplier.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return { subject, body, html, mailtoUrl };
}

export async function sendInvite(supplier: Supplier): Promise<void> {
  if (!supplier.email) {
    throw new Error('Für diesen Lieferanten ist keine E-Mail-Adresse hinterlegt.');
  }
  const { subject, body, html } = buildInvite(supplier);
  await send({ to: [supplier.email], subject, text: body, html });
}

// ---------------------------------------------------------------------------
// Aktivitäts-Zusammenfassung ("Update senden")
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildDigest(project: Project, entries: ActivityEntry[]) {
  const subject = `Update zu Bauprojekt "${project.name}" – Baukoordination Swiss Solar Ventures AG`;
  const lines = [
    `Hallo zusammen`,
    ``,
    `hier ein Update zum Projekt "${project.name}"${project.ort ? ` (${project.ort})` : ''}:`,
    ``,
  ];
  if (entries.length) {
    for (const a of entries) {
      lines.push(`- ${a.actor_name} ${a.text} (${fmtDate(a.created_at)})`);
    }
  } else {
    lines.push('(Noch keine Aktivität protokolliert.)');
  }
  lines.push('', 'Freundliche Grüsse', 'Swiss Solar Ventures AG');

  const rows = entries.length
    ? entries
        .map(
          (a) => `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #D9D9D9;font-size:18px;width:30px;vertical-align:top;">${escapeHtml(a.icon ?? '•')}</td>
            <td style="padding:8px 0;border-bottom:1px solid #D9D9D9;font-size:13.5px;line-height:1.5;">
              <strong>${escapeHtml(a.actor_name)}</strong> ${escapeHtml(a.text)}<br />
              <span style="font-size:11.5px;color:#929291;">${escapeHtml(fmtDate(a.created_at))}</span>
            </td>
          </tr>`,
        )
        .join('')
    : `<tr><td style="font-size:13.5px;color:#929291;padding:8px 0;">Noch keine Aktivität protokolliert.</td></tr>`;

  const html = wrapHtml(`Update zu "${project.name}"`, `
    <p style="font-size:14px;line-height:1.6;margin:0 0 14px;">
      Hallo zusammen, hier der aktuelle Stand zum Projekt
      <strong>${escapeHtml(project.name)}</strong>${project.ort ? ` (${escapeHtml(project.ort)})` : ''}:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>
    <p style="margin:18px 0 0;">
      <a href="${escapeHtml(appBaseUrl())}" style="display:inline-block;background:#00BF63;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">Projekt öffnen</a>
    </p>
  `);

  return { subject, body: lines.join('\n'), html };
}

/** Alle Lieferanten-E-Mails mit Zugriff auf ein Projekt. */
export async function projectRecipients(projectId: string): Promise<string[]> {
  const { data } = await serviceClient()
    .from('project_access')
    .select('suppliers(email)')
    .eq('project_id', projectId);

  const rows = (data ?? []) as unknown as Array<{
    suppliers: { email: string | null } | null;
  }>;

  return Array.from(
    new Set(
      rows
        .map((r) => r.suppliers?.email?.trim())
        .filter((e): e is string => Boolean(e)),
    ),
  );
}

/**
 * Alle am Projekt Beteiligten: die freigegebenen Lieferanten und sämtliche
 * Bauherrenvertreter. Wer die Aktion selbst ausgelöst hat, bekommt keine Mail –
 * eine Benachrichtigung über das eigene Tun ist nur Lärm.
 */
export async function allProjectParties(
  projectId: string,
  exceptEmail?: string | null,
): Promise<string[]> {
  const suppliers = await projectRecipients(projectId);

  const { data: admins } = await serviceClient().from('admins').select('email');
  const adminMails = (admins ?? [])
    .map((a: { email: string | null }) => a.email?.trim())
    .filter((e): e is string => Boolean(e));

  const ausgeschlossen = exceptEmail?.trim().toLowerCase();

  return Array.from(new Set([...suppliers, ...adminMails])).filter(
    (mail) => mail.toLowerCase() !== ausgeschlossen,
  );
}

/**
 * Empfänger für vertrauliche Vorgänge: alle Bauherrenvertreter und genau der
 * eine Lieferant, den es betrifft – etwa beim Einreichen einer Offerte.
 */
async function adminsUndEinLieferant(
  supplierId: string,
  exceptEmail?: string | null,
): Promise<string[]> {
  const db = serviceClient();

  const [{ data: admins }, { data: supplier }] = await Promise.all([
    db.from('admins').select('email'),
    db.from('suppliers').select('email').eq('id', supplierId).maybeSingle(),
  ]);

  const mails = [
    ...(admins ?? []).map((a: { email: string | null }) => a.email?.trim()),
    supplier?.email?.trim(),
  ].filter((e): e is string => Boolean(e));

  const ausgeschlossen = exceptEmail?.trim().toLowerCase();
  return Array.from(new Set(mails)).filter(
    (mail) => mail.toLowerCase() !== ausgeschlossen,
  );
}

export async function sendDigest(
  project: Project,
  entries: ActivityEntry[],
): Promise<number> {
  const to = await projectRecipients(project.id);
  const { subject, body, html } = buildDigest(project, entries);
  await send({ to, subject, text: body, html });
  return to.length;
}

// ---------------------------------------------------------------------------
// Sofort-Benachrichtigung pro Aktion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fristablauf
// ---------------------------------------------------------------------------

/**
 * E-Mail-Adressen des Zuständigen einer Aufgabe.
 *
 * Ist die Aufgabe der Firma allgemein zugewiesen, geht die Mahnung an alle
 * Bauherrenvertreter – sonst läge sie bei niemandem auf dem Tisch.
 */
export async function assigneeRecipients(assignedTo: string): Promise<string[]> {
  const db = serviceClient();

  if (assignedTo.startsWith('admin:')) {
    const { data } = await db
      .from('admins')
      .select('email')
      .eq('user_id', assignedTo.slice(6))
      .maybeSingle();
    const mail = data?.email?.trim();
    return mail ? [mail] : [];
  }

  if (assignedTo.startsWith('supplier:') || assignedTo !== 'internal') {
    const id = assignedTo.startsWith('supplier:') ? assignedTo.slice(9) : assignedTo;
    const { data } = await db
      .from('suppliers')
      .select('email')
      .eq('id', id)
      .maybeSingle();
    const mail = data?.email?.trim();
    return mail ? [mail] : [];
  }

  const { data } = await db.from('admins').select('email');
  return (data ?? [])
    .map((a: { email: string | null }) => a.email?.trim())
    .filter((e): e is string => Boolean(e));
}

/** Dringende Mahnung, wenn eine Frist verstrichen ist. */
export async function sendOverdueNotice(params: {
  to: string[];
  todoText: string;
  projectName: string;
  dueLabel: string;
  tageUeberfaellig: number;
}): Promise<void> {
  const tage =
    params.tageUeberfaellig === 1 ? 'seit gestern' : `seit ${params.tageUeberfaellig} Tagen`;

  const subject = `Frist überschritten: "${params.todoText}" – ${params.projectName}`;

  const text = [
    `Diese Aufgabe ist ${tage} überfällig und noch nicht erledigt:`,
    ``,
    `Aufgabe: ${params.todoText}`,
    `Projekt: ${params.projectName}`,
    `Zu erledigen bis: ${params.dueLabel}`,
    ``,
    `Bitte erledige sie oder melde dich, falls etwas dagegen spricht:`,
    appBaseUrl(),
  ].join('\n');

  const html = wrapHtml(`Frist überschritten`, `
    <div style="background:#FAE1DD;border-radius:8px;padding:12px 14px;margin:0 0 16px;">
      <strong style="color:#C0392B;font-size:14px;">Diese Aufgabe ist ${escapeHtml(tage)} überfällig.</strong>
    </div>
    <p style="font-size:16px;line-height:1.5;margin:0 0 14px;"><strong>${escapeHtml(params.todoText)}</strong></p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13.5px;margin:0 0 18px;">
      <tr>
        <td style="padding:4px 0;color:#929291;width:120px;">Projekt</td>
        <td style="padding:4px 0;">${escapeHtml(params.projectName)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#929291;">Zu erledigen bis</td>
        <td style="padding:4px 0;color:#C0392B;font-weight:600;">${escapeHtml(params.dueLabel)}</td>
      </tr>
    </table>
    <p style="margin:0;">
      <a href="${escapeHtml(appBaseUrl())}" style="display:inline-block;background:#00BF63;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">Aufgabe öffnen</a>
    </p>
  `);

  await send({ to: params.to, subject, text, html, dringend: true });
}

export async function sendActivityNotification(params: {
  projectId: string;
  actorName: string;
  actorEmail?: string | null;
  text: string;
  /** Gesetzt bei vertraulichen Einträgen (Offerten): nur wir und dieser Lieferant. */
  nurFuerSupplierId?: string | null;
}): Promise<void> {
  if (!mailEnabled() || !notifyOnEveryActivity()) return;

  const { data: project } = await serviceClient()
    .from('projects')
    .select('id, name, ort, created_at')
    .eq('id', params.projectId)
    .maybeSingle();
  if (!project) return;

  const to = params.nurFuerSupplierId
    ? await adminsUndEinLieferant(params.nurFuerSupplierId, params.actorEmail)
    : await allProjectParties(params.projectId, params.actorEmail);
  if (!to.length) return;

  const subject = `${project.name}: ${params.actorName} ${params.text}`.slice(0, 120);
  const text = `${params.actorName} ${params.text}\n\nProjekt: ${project.name}\n${appBaseUrl()}`;
  const html = wrapHtml(`Neue Aktivität in "${project.name}"`, `
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">
      <strong>${escapeHtml(params.actorName)}</strong> ${escapeHtml(params.text)}
    </p>
    <p style="margin:0;">
      <a href="${escapeHtml(appBaseUrl())}" style="display:inline-block;background:#00BF63;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">Projekt öffnen</a>
    </p>
  `);

  await send({ to, subject, text, html });
}
