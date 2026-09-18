import 'server-only';
import { Resend } from 'resend';
import { appBaseUrl, mailFrom, mailReplyTo, resendApiKey } from '@/lib/env';
import { firmenKollegen } from '@/lib/auth/offerAccess';
import { serviceClient } from '@/lib/supabase/service';
import { APP_HERKUNFT, APP_RECHTE } from '@/lib/branding';
import {
  einsetzen,
  ladeVorlage,
  type VorlagenSchluessel,
} from '@/lib/mailVorlagen';
import type { ActivityEntry, Project, Supplier } from '@/types';

function client(): Resend | null {
  const key = resendApiKey();
  return key ? new Resend(key) : null;
}

/**
 * Notbremse: MAIL_AUS=true hält jede Mail zurück.
 *
 * Gedacht für den Fall, dass etwas ungewollt hinausgeht und es schnell gehen
 * muss. Wirkt auf alles – Benachrichtigungen, Fristerinnerungen, Updates und
 * auch die Einladung, die sonst als einzige nach aussen darf.
 *
 * Bewusst eine Umgebungsvariable und keine Einstellung in der Datenbank: Eine
 * Notbremse darf nicht davon abhängen, dass die Datenbank erreichbar ist.
 */
export function mailAus(): boolean {
  return process.env.MAIL_AUS === 'true';
}

export function mailEnabled(): boolean {
  return Boolean(resendApiKey()) && !mailAus();
}

/**
 * Bekommen ausnahmslos alle Lieferanten Benachrichtigungen?
 *
 * Standardmässig nein. Das ist aber nicht mehr die einzige Stelle: Einzelne
 * Personen lassen sich in den Kontakten freischalten (Spalte mail_an, siehe
 * freigegebeneAdressen weiter unten). Der Weg dorthin führt bewusst über die
 * Person und nicht über einen Schalter für alle – so kommt niemand ungefragt
 * zu Post, nur weil jemand anderes dazugenommen wurde.
 *
 * Dieser Schalter bleibt für den Tag, an dem wirklich alle Post bekommen
 * sollen; bis dahin genügt die Freigabe je Person.
 *
 * Die ausdrücklich ausgelöste Einladung mit dem Zugangscode ist von beidem
 * ausgenommen; ohne sie käme niemand herein.
 */
export function mailAnLieferanten(): boolean {
  return process.env.MAIL_AN_LIEFERANTEN === 'true';
}

/** Was als "wir" gilt. Alles unter dieser Domain zählt als intern. */
function interneDomain(): string {
  return (process.env.MAIL_INTERNE_DOMAIN || 'swiss-sv.ch').trim().toLowerCase();
}

function istIntern(adresse: string): boolean {
  return adresse.trim().toLowerCase().endsWith(`@${interneDomain()}`);
}

/**
 * Adressen ausserhalb der Firma, die ausdrücklich freigegeben sind.
 *
 * Die Domain allein reichte nicht mehr: Einzelne Lieferanten sollen Post
 * bekommen, andere noch nicht. Ohne Migration 0027 gibt es die Spalte nicht –
 * dann bleibt es beim bisherigen Verhalten, also niemand von aussen.
 */
async function freigegebeneAdressen(): Promise<Set<string>> {
  const { data, error } = await serviceClient()
    .from('suppliers')
    .select('email')
    .eq('mail_an', true);

  if (error) return new Set();

  return new Set(
    ((data ?? []) as Array<{ email: string | null }>)
      .map((z) => z.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e)),
  );
}

/**
 * Adressen von uns, die für dieses Projekt Post bekommen sollen.
 *
 * Ist niemand zugeteilt, gehen die Nachrichten an alle – sonst würde ein neu
 * angelegtes Projekt still verstummen und niemand merkte es. Die Zuteilung ist
 * ein Filter für die Post, kein Zugriffsrecht: Gesehen wird überall alles.
 *
 * Ohne Migration 0024 gibt es die Tabelle noch nicht; dann bleibt es beim
 * bisherigen Verhalten.
 */
async function unsereEmpfaenger(projectId?: string): Promise<string[]> {
  const db = serviceClient();

  const alle = await db.from('admins').select('user_id, email');
  if (alle.error) return [];

  const zeilen = (alle.data ?? []) as Array<{ user_id: string; email: string | null }>;

  if (projectId) {
    const zugeteilt = await db
      .from('project_admins')
      .select('user_id')
      .eq('project_id', projectId);

    const ids = zugeteilt.error
      ? []
      : ((zugeteilt.data ?? []) as Array<{ user_id: string }>).map((z) => z.user_id);

    if (ids.length) {
      return zeilen
        .filter((a) => ids.includes(a.user_id) && a.email)
        .map((a) => a.email!.trim());
    }
  }

  return zeilen.filter((a) => a.email).map((a) => a.email!.trim());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Aus dem in der App bearbeiteten Text die HTML-Fassung bauen.
 *
 * Leerzeilen trennen Absätze, einfache Zeilenumbrüche bleiben Umbrüche, und
 * Adressen werden anklickbar. Alles wird zuvor maskiert: Was jemand in die
 * Vorlage tippt, darf die Gestaltung der Mail nicht durcheinanderbringen.
 */
function textZuHtml(text: string): string {
  const linkify = (teil: string) =>
    escapeHtml(teil).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#00BF63;">$1</a>',
    );

  return text
    .split(/\n\s*\n/)
    .map(
      (absatz) =>
        `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;">${linkify(absatz).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');
}

/** Rahmen im SSV-Look: Gelb→Grün-Verlauf als Akzentbalken, Poppins als Schrift. */
function wrapHtml(title: string, bodyHtml: string): string {
  const hinweis = keineAntwort();

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:24px;background:#F2F2F1;font-family:Poppins,Helvetica,Arial,sans-serif;color:#262624;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;background:#FFFFFF;border:1px solid #D9D9D9;border-radius:10px;overflow:hidden;">
    <tr>
      <td style="width:10px;background:linear-gradient(180deg,#FFBD59 0%,#00BF63 100%);"></td>
      <td style="padding:22px 24px;">
        <!-- Absolute Adresse, weil das Bild im Mailprogramm des Empfängers
             geladen wird. Wer Bilder blockiert, sieht den Alternativtext. -->
        <img src="${escapeHtml(appBaseUrl())}/logo.png" alt="Swiss Solar Ventures AG"
             width="150" style="display:block;border:0;margin:0 0 14px;height:auto;" />
        <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#929291;">Baukoordination</div>
        <h1 style="font-size:20px;margin:4px 0 16px;color:#262624;">${escapeHtml(title)}</h1>
        ${bodyHtml}
        <!-- Derselbe Hinweis wie in der Nur-Text-Fassung, damit beide Fassungen
             der Mail nicht Unterschiedliches behaupten. -->
        <p style="margin:22px 0 0;font-size:11.5px;color:#929291;border-top:1px solid #D9D9D9;padding-top:12px;">
          Swiss Solar Ventures AG · Diese Nachricht wurde automatisch aus der Baukoordination
          versendet.<br />
          <strong>${escapeHtml(hinweis.warnung)}</strong> ${escapeHtml(hinweis.erklaerung)}<br />
          <!-- Geht an jeden Empfänger und kostet eine Zeile: Wer die App nutzt,
               soll wissen, von wem sie stammt. -->
          <span style="color:#A8A8A6;">${escapeHtml(APP_HERKUNFT)} ${escapeHtml(APP_RECHTE)}</span>
        </p>
      </td>
    </tr>
  </table>
</body></html>`;
}

/**
 * Hinweis am Fuss jeder verschickten Nachricht.
 *
 * Hinter der Absenderadresse liegt kein Postfach – sie dient nur dem Versand.
 * Der Hinweis muss das deutlich sagen: Eine Antwort dorthin käme nirgends an,
 * sondern prallt als Unzustellbarkeitsmeldung zurück. Wer das nicht weiss,
 * hält seine Rückmeldung für zugestellt und wartet auf Antwort.
 *
 * Ist eine Antwortadresse hinterlegt (MAIL_REPLY_TO), landen Antworten sehr
 * wohl irgendwo – dann sagt der Hinweis genau das. So bleibt der Text richtig,
 * egal wie der Versand eingestellt ist.
 *
 * Der Hinweis steht nur in dem, was die App selbst verschickt; Texte zum
 * Selbstverschicken bleiben sauber.
 */
function keineAntwort(): { warnung: string; erklaerung: string } {
  const antwortAn = mailReplyTo();

  if (antwortAn) {
    return {
      warnung: 'Diese Adresse verschickt nur.',
      erklaerung:
        `Ein Postfach gibt es dahinter nicht; Antworten gehen an ${antwortAn}. ` +
        'Am besten schreibst du deine Rückmeldung direkt in der App als ' +
        'Kommentar, dann steht sie beim richtigen Vorgang.',
    };
  }

  return {
    warnung: 'Bitte antworte nicht auf diese E-Mail.',
    erklaerung:
      'Hinter dieser Adresse gibt es kein Postfach, eine Antwort kommt nicht an. ' +
      'Schreib deine Rückmeldung direkt in der App als Kommentar oder melde dich ' +
      'bei deiner Ansprechperson bei der Swiss Solar Ventures AG.',
  };
}

/** Die blosse Adresse aus MAIL_FROM, ohne den Anzeigenamen davor. */
function absenderAdresse(): string {
  const treffer = mailFrom().match(/<([^>]+)>/);
  return treffer ? treffer[1] : mailFrom();
}

async function send(params: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  /**
   * Darf ausnahmsweise auch nach aussen gehen – gesetzt allein von der
   * Einladung, die von Hand ausgelöst wird und die Anmeldedaten enthält.
   */
  anLieferanten?: boolean;
}): Promise<void> {
  // Vor allem anderen: Ist die Notbremse gezogen, geht gar nichts raus – auch
  // nicht die Einladung und auch nicht das Testmail. Die Prüfung steht hier im
  // Versandweg selbst und nicht nur bei den Aufrufern; eine Notbremse, die man
  // an einer Stelle vergessen kann, ist keine.
  if (mailAus()) {
    throw new Error(
      'Der Mailversand ist abgeschaltet (MAIL_AUS=true in Vercel). ' +
        'Zum Wiedereinschalten die Variable entfernen und neu bereitstellen.',
    );
  }

  const resend = client();
  if (!resend) throw new Error('Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt).');
  if (!params.to.length) throw new Error('Keine Empfänger mit hinterlegter E-Mail-Adresse.');

  const antwortAn = mailReplyTo();
  const hinweis = keineAntwort();

  // Die eine Stelle, an der entschieden wird, wer Post bekommt. Jede Nachricht
  // läuft hier durch – Einladung, Benachrichtigung, Update, Mahnung. Eine
  // Prüfung je Versandart hätte früher oder später eine vergessen.
  let empfaenger = params.to;

  if (!mailAnLieferanten() && !params.anLieferanten) {
    const frei = await freigegebeneAdressen();
    empfaenger = empfaenger.filter(
      (a) => istIntern(a) || frei.has(a.trim().toLowerCase()),
    );
    if (!empfaenger.length) return;
  }

  const { error } = await resend.emails.send({
    from: mailFrom(),
    to: empfaenger,
    ...(antwortAn ? { replyTo: antwortAn } : {}),
    subject: params.subject,
    // Beide Fassungen der Mail tragen denselben Fuss – sonst behauptete die
    // Nur-Text-Fassung etwas anderes als die gestaltete.
    text: `${params.text}\n\n—\n${hinweis.warnung} ${hinweis.erklaerung}\n${APP_HERKUNFT} ${APP_RECHTE}`,
    html: params.html,
    // Jede Nachricht aus der App geht als dringend hinaus: Outlook setzt das
    // rote Ausrufezeichen, Apple Mail und Gmail sortieren sie nach oben.
    //
    // Bewusst ohne Ausnahme und ohne Schalter je Versandart. Eine Baustelle
    // hält keine zwei Dringlichkeitsstufen aus: Wer entscheiden müsste, ob eine
    // Terminverschiebung dringend ist, entscheidet es jedes Mal anders. Wird
    // eine Aufgabe hochgeladen, während jemand auf dem Dach steht, zählt jede
    // Nachricht.
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      Importance: 'high',
    },
  });

  if (error) {
    throw new Error(`Mailversand fehlgeschlagen: ${error.message ?? String(error)}`);
  }
}

/**
 * Testmail an die eigene Adresse – prüft Schlüssel, Absender und Zustellung in
 * einem Schritt. Fehler werden bewusst durchgereicht statt geschluckt.
 */
export async function sendTestMail(an: string, name: string): Promise<void> {
  const html = wrapHtml('Der Mailversand funktioniert', `
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">
      Ciao ${escapeHtml(name.split(/\s+/)[0] || 'zusammen')}<br />
      wenn du das liest, verschickt die Baukoordination ab sofort automatisch
      Benachrichtigungen – bei neuen Aufgaben, Kommentaren, Dateien und
      überschrittenen Fristen.
    </p>
    <p style="font-size:13px;line-height:1.6;color:#6B6B69;margin:0 0 16px;">
      Absender: ${escapeHtml(mailFrom())}<br />
      Antworten gehen an: ${escapeHtml(mailReplyTo() ?? absenderAdresse())}
    </p>
    <p style="margin:0;">
      <a href="${escapeHtml(appBaseUrl())}" style="display:inline-block;background:#00BF63;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">Baukoordination öffnen</a>
    </p>
  `);

  await send({
    to: [an],
    subject: 'Testmail aus der Baukoordination',
    text:
      'Wenn du das liest, funktioniert der automatische Mailversand.\n\n' +
      `Absender: ${mailFrom()}\n` +
      `Antworten gehen an: ${mailReplyTo() ?? absenderAdresse()}\n` +
      `\n${appBaseUrl()}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Einladung
// ---------------------------------------------------------------------------

/** Nur der Vorname – die Anrede im Einladungstext ist bewusst persönlich gehalten. */
function firstName(supplier: Pick<Supplier, 'name' | 'firma'>): string {
  const full = supplier.name?.trim() || supplier.firma?.trim() || '';
  return full.split(/\s+/)[0] || 'zusammen';
}

export async function buildInvite(supplier: Supplier) {
  const vorlage = await ladeVorlage('einladung');

  const werte = {
    vorname: firstName(supplier),
    name: supplier.name?.trim() || supplier.firma?.trim() || '',
    firma: supplier.firma?.trim() || '',
    email: supplier.email?.trim() || '',
    // Ist noch keines vergeben, steht das im Text – besser als eine Lücke, bei
    // der sich der Empfänger fragt, ob die Mail unvollständig ist.
    passwort: supplier.start_passwort?.trim() || '– bitte bei uns nachfragen –',
    link: appBaseUrl(),
  };

  const subject = einsetzen(vorlage.betreff, werte);
  const body = einsetzen(vorlage.text, werte);
  const html = wrapHtml('Zugriff auf die Baukoordination-App', textZuHtml(body));

  const mailtoUrl = `mailto:${encodeURIComponent(supplier.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return { subject, body, html, mailtoUrl };
}

export async function sendInvite(supplier: Supplier): Promise<void> {
  if (!supplier.email) {
    throw new Error('Für diesen Lieferanten ist keine E-Mail-Adresse hinterlegt.');
  }
  const { subject, body, html } = await buildInvite(supplier);
  // Ausnahme von der Regel oben: Ohne Einladung käme kein Lieferant herein.
  // Sie wird von Hand ausgelöst, ist also nie ungefragte Post.
  await send({ to: [supplier.email], subject, text: body, html, anLieferanten: true });
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

export async function buildDigest(project: Project, entries: ActivityEntry[]) {
  const vorlage = await ladeVorlage('update');

  const eintraege = entries.length
    ? entries
        .map((a) => `- ${a.actor_name} ${a.text} (${fmtDate(a.created_at)})`)
        .join('\n')
    : '(Noch keine Aktivität protokolliert.)';

  const werte = {
    projekt: project.name,
    ort: project.ort ?? '',
    eintraege,
    link: appBaseUrl(),
  };

  const subject = einsetzen(vorlage.betreff, werte);
  const body = einsetzen(vorlage.text, werte);
  const html = wrapHtml(`Update zu "${project.name}"`, textZuHtml(body));

  return { subject, body, html };
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
 * Die Mailadresse eines Lieferanten – zum Ausschliessen des Auslösers.
 *
 * Bei uns steht die Adresse in der Sitzung, bei Lieferanten nicht: Sie melden
 * sich mit einem Zugangscode an. Ohne diesen Umweg bekäme ein Lieferant Post
 * über seinen eigenen Kommentar.
 */
async function lieferantenMail(supplierId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('suppliers')
    .select('email')
    .eq('id', supplierId)
    .maybeSingle();

  return (data as { email: string | null } | null)?.email?.trim() || null;
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
  const adminMails = await unsereEmpfaenger(projectId);

  const ausgeschlossen = exceptEmail?.trim().toLowerCase();

  return Array.from(new Set([...suppliers, ...adminMails])).filter(
    (mail) => mail.toLowerCase() !== ausgeschlossen,
  );
}

/**
 * Empfänger für eine Sache, die genau benannten Personen gehört.
 *
 * Anders als adminsUndFirmen ohne die Kolleginnen und Kollegen derselben Firma:
 * Ist eine Aufgabe Ralph zugewiesen, geht die Meldung an Ralph – nicht an
 * Stive und Mergim, die zufällig bei derselben Firma arbeiten. Bei einer
 * Offerte ist die Firma das Richtige, bei einer Aufgabe die Person.
 *
 * Wir bekommen die Post in jedem Fall; eine leere Liste heisst deshalb
 * "nur wir" und nicht "niemand".
 */
async function adminsUndPersonen(
  supplierIds: string[],
  exceptEmail?: string | null,
  projectId?: string,
): Promise<string[]> {
  const db = serviceClient();

  // Nur wer für dieses Projekt freigegeben ist – sonst bekäme jemand Post über
  // ein Projekt, das er in der App gar nicht öffnen kann.
  let ids = supplierIds;
  if (projectId && ids.length) {
    const { data } = await db
      .from('project_access')
      .select('supplier_id')
      .eq('project_id', projectId);

    const erlaubt = new Set(
      ((data ?? []) as Array<{ supplier_id: string }>).map((z) => z.supplier_id),
    );
    ids = ids.filter((id) => erlaubt.has(id));
  }

  const [admins, { data: supplier }] = await Promise.all([
    unsereEmpfaenger(projectId),
    ids.length
      ? db.from('suppliers').select('email').in('id', ids)
      : Promise.resolve({ data: [] as Array<{ email: string | null }> }),
  ]);

  const ausgeschlossen = exceptEmail?.trim().toLowerCase();

  return Array.from(
    new Set([
      ...admins,
      ...((supplier ?? []) as Array<{ email: string | null }>)
        .map((z) => z.email?.trim())
        .filter((e): e is string => Boolean(e)),
    ]),
  ).filter((mail) => mail.toLowerCase() !== ausgeschlossen);
}

/**
 * Empfänger für eingeschränkte Vorgänge: alle Bauherrenvertreter und die
 * betroffenen Lieferantenfirmen – also auch die weiteren Ansprechpersonen
 * derselben Firma, die gemeinsam an der Sache arbeiten.
 */
async function adminsUndFirmen(
  supplierIds: string[],
  exceptEmail?: string | null,
  projectId?: string,
): Promise<string[]> {
  const db = serviceClient();
  let kollegen = (
    await Promise.all(supplierIds.map((id) => firmenKollegen(id)))
  ).flat();

  // Nur wer für dieses Projekt freigegeben ist. Eine Firma kann auf dem einen
  // Projekt mitarbeiten und auf dem anderen nicht; ohne diese Prüfung bekäme
  // ein Kollege Post über ein Projekt, das er in der App gar nicht öffnen kann.
  if (projectId && kollegen.length) {
    const { data } = await db
      .from('project_access')
      .select('supplier_id')
      .eq('project_id', projectId);

    const erlaubt = new Set(
      ((data ?? []) as Array<{ supplier_id: string }>).map((z) => z.supplier_id),
    );
    kollegen = kollegen.filter((id) => erlaubt.has(id));
  }

  const [admins, { data: supplier }] = await Promise.all([
    unsereEmpfaenger(projectId),
    kollegen.length
      ? db.from('suppliers').select('email').in('id', kollegen)
      : Promise.resolve({ data: [] as Array<{ email: string | null }> }),
  ]);

  const mails = [
    ...admins,
    ...((supplier ?? []) as Array<{ email: string | null }>).map((s) =>
      s.email?.trim(),
    ),
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
  const { subject, body, html } = await buildDigest(project, entries);
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
export async function allAssigneeRecipients(
  assignees: string[] | null | undefined,
  fallback: string,
): Promise<string[]> {
  const liste = assignees?.length ? assignees : [fallback];
  const alle = await Promise.all(liste.map((a) => assigneeRecipients(a)));
  return Array.from(new Set(alle.flat()));
}

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
/**
 * Erinnerung vor der Frist – zwei Tage vorher und am Tag selbst.
 *
 * Bewusst gelb und nicht rot. Rot ist die Mahnung; wer beides gleich einfärbt,
 * nimmt der Mahnung ihre Wirkung, und nach zwei Wochen sieht niemand mehr hin.
 * Hier ist noch nichts passiert.
 *
 * Die Überschrift nennt Aufgabe und Projekt: "Morgen fällig" allein sagt im
 * Postfach nichts, wenn drei solche Mails nebeneinander liegen.
 */
export async function sendFristErinnerung(params: {
  to: string[];
  todoText: string;
  projectName: string;
  dueLabel: string;
  /** 'vorlauf' = vor der Frist, 'heute' = der Tag der Frist. */
  wann: 'vorlauf' | 'heute';
  /**
   * Wie die Frist genannt wird: "in 2 Tagen", "morgen", "am Samstag".
   *
   * Nötig, weil der Vorlauf nicht mehr immer genau zwei Tage beträgt: Am
   * Freitag geht die Erinnerung für das ganze Wochenende und den Wochenanfang
   * mit hinaus, weil Samstag und Sonntag keine Post an die Lieferanten geht.
   * "In zwei Tagen" wäre dann für die Hälfte der Mails schlicht falsch.
   */
  wannText?: string;
}): Promise<void> {
  const vorlage = await ladeVorlage(
    params.wann === 'vorlauf' ? 'fristnah' : 'fristheute',
  );

  const wannText = params.wannText ?? 'in 2 Tagen';

  const werte = {
    projekt: params.projectName,
    aufgabe: params.todoText,
    frist: params.dueLabel,
    wann: wannText,
    link: appBaseUrl(),
  };

  const subject = einsetzen(vorlage.betreff, werte);
  const text = einsetzen(vorlage.text, werte);

  // Grossgeschrieben, weil es am Anfang der Überschrift steht.
  const grossWann = wannText.charAt(0).toUpperCase() + wannText.slice(1);
  const kopf = params.wann === 'vorlauf' ? `Fällig ${wannText}` : 'Heute fällig';
  const banner =
    params.wann === 'vorlauf'
      ? `${grossWann} fällig – ${escapeHtml(params.dueLabel)}.`
      : `Diese Aufgabe ist heute fällig – ${escapeHtml(params.dueLabel)}.`;

  const html = wrapHtml(
    `${kopf} – ${params.todoText} – ${params.projectName}`,
    `<div style="background:#FFF0D9;border-radius:8px;padding:12px 14px;margin:0 0 16px;">
      <strong style="color:#8A6116;font-size:14px;">${banner}</strong>
    </div>` + textZuHtml(text),
  );

  await send({ to: params.to, subject, text, html });
}

export async function sendOverdueNotice(params: {
  to: string[];
  todoText: string;
  projectName: string;
  dueLabel: string;
  tageUeberfaellig: number;
}): Promise<void> {
  const tage =
    params.tageUeberfaellig === 1 ? 'seit gestern' : `seit ${params.tageUeberfaellig} Tagen`;

  const vorlage = await ladeVorlage('fristablauf');
  const werte = {
    projekt: params.projectName,
    aufgabe: params.todoText,
    frist: params.dueLabel,
    ueberfaellig: tage,
    link: appBaseUrl(),
  };

  const subject = einsetzen(vorlage.betreff, werte);
  const text = einsetzen(vorlage.text, werte);

  const html = wrapHtml(
    'Frist überschritten',
    `<div style="background:#FAE1DD;border-radius:8px;padding:12px 14px;margin:0 0 16px;">
      <strong style="color:#C0392B;font-size:14px;">Diese Aufgabe ist ${escapeHtml(tage)} überfällig.</strong>
    </div>` + textZuHtml(text),
  );

  await send({ to: params.to, subject, text, html });
}

export async function sendActivityNotification(params: {
  projectId: string;
  actorName: string;
  actorEmail?: string | null;
  /** Gesetzt, wenn ein Lieferant die Sache ausgelöst hat – siehe lieferantenMail. */
  actorSupplierId?: string | null;
  text: string;
  /**
   * Gesetzt bei eingeschränkten Einträgen: nur wir und die Firmen dieser
   * Lieferanten. Leere Liste = nur wir. Weglassen = alle Beteiligten.
   */
  nurFuerSupplierIds?: string[];
  /**
   * Genau diese Personen – ohne die Kolleginnen und Kollegen derselben Firma.
   *
   * Hat Vorrang vor nurFuerSupplierIds. Für Aufgaben ist das der richtige
   * Zuschnitt: Eine Aufgabe gehört einer Person, eine Offerte einer Firma.
   */
  empfaengerGenau?: string[];
}): Promise<void> {
  // Welche Ereignisse überhaupt Post auslösen, entscheidet der Aufrufer über
  // logActivity({ notify: true }) – es sind bewusst nur wenige. Ein zusätzlicher
  // Schalter hier hätte diese Auswahl still ausgehebelt.
  if (!mailEnabled()) return;

  const { data: project } = await serviceClient()
    .from('projects')
    .select('id, name, ort, created_at')
    .eq('id', params.projectId)
    .maybeSingle();
  if (!project) return;

  // Der Auslöser fällt raus. Bei uns steht die Adresse in der Sitzung, bei
  // Lieferanten muss sie erst nachgeschlagen werden.
  const eigeneAdresse =
    params.actorEmail ??
    (params.actorSupplierId ? await lieferantenMail(params.actorSupplierId) : null);

  const to = params.empfaengerGenau
    ? await adminsUndPersonen(params.empfaengerGenau, eigeneAdresse, params.projectId)
    : params.nurFuerSupplierIds
      ? await adminsUndFirmen(
          params.nurFuerSupplierIds,
          eigeneAdresse,
          params.projectId,
        )
      : await allProjectParties(params.projectId, eigeneAdresse);
  if (!to.length) return;

  /**
   * Wer sofort Post bekommt – und wer sie gesammelt bekommt.
   *
   * Die Lieferanten bekamen für jede Kleinigkeit eine eigene Mail: drei neue
   * Aufgaben am Vormittag waren drei Mails. Wer so viel Post aus einem Werkzeug
   * bekommt, liest nach zwei Wochen keine davon mehr – und dann ist auch die
   * wichtige nichts mehr wert. Für sie wandert die Meldung deshalb in die
   * Warteschlange und geht am nächsten Morgen um halb acht gebündelt hinaus.
   *
   * Bei uns bleibt es beim sofortigen Versand. Wer die Baustelle koordiniert,
   * muss von der Rückfrage am Vormittag am Vormittag erfahren und nicht am
   * nächsten Morgen. Soll auch das gesammelt werden, genügt es, hier nicht mehr
   * zwischen innen und aussen zu unterscheiden.
   */
  const sofort = to.filter((a) => istIntern(a));
  const spaeter = to.filter((a) => !istIntern(a));

  const vorlage = await ladeVorlage('benachrichtigung');
  const werte = {
    projekt: project.name,
    wer: params.actorName,
    was: params.text,
    link: appBaseUrl(),
  };

  if (sofort.length) {
    const subject = einsetzen(vorlage.betreff, werte).slice(0, 120);
    const text = einsetzen(vorlage.text, werte);
    const html = wrapHtml(`Neue Aktivität in "${project.name}"`, textZuHtml(text));
    await send({ to: sofort, subject, text, html });
  }

  if (spaeter.length) {
    await sammeln({
      empfaenger: spaeter,
      projectId: project.id,
      projektName: project.name,
      text: `${params.actorName} ${params.text}`,
    });
  }
}

/**
 * Eine Meldung in die Warteschlange für die Sammelmail legen.
 *
 * Denselben Filter wie beim sofortigen Versand: Wer nicht freigeschaltet ist,
 * kommt gar nicht erst in die Schlange. Sonst stünde dort Post für Leute, die
 * keine wollen, und sie bliebe für immer liegen.
 *
 * Fehlt Migration 0037, geht die Meldung wie früher sofort hinaus. Lieber eine
 * Mail zu viel als eine verlorene.
 */
async function sammeln(params: {
  empfaenger: string[];
  projectId: string;
  projektName: string;
  text: string;
}): Promise<void> {
  let ziele = params.empfaenger;

  if (!mailAnLieferanten()) {
    const frei = await freigegebeneAdressen();
    ziele = ziele.filter((a) => frei.has(a.trim().toLowerCase()));
  }
  if (!ziele.length) return;

  const { error } = await serviceClient()
    .from('mail_queue')
    .insert(
      ziele.map((empfaenger) => ({
        empfaenger,
        project_id: params.projectId,
        projekt_name: params.projektName,
        text: params.text,
      })),
    );

  if (!error) return;

  // Ohne die Tabelle bleibt es beim bisherigen Verhalten.
  console.warn('[mail] Sammelmail nicht möglich, sende einzeln', error.message);
  const html = wrapHtml(
    `Neue Aktivität in "${params.projektName}"`,
    textZuHtml(`${params.text}\n\nProjekt: ${params.projektName}\n${appBaseUrl()}`),
  );
  await send({
    to: ziele,
    subject: `${params.projektName}: ${params.text}`.slice(0, 120),
    text: `${params.text}\n\nProjekt: ${params.projektName}\n${appBaseUrl()}`,
    html,
  });
}

/**
 * Die morgendliche Sammelmail verschicken.
 *
 * Eine Nachricht je Person mit allem, was seit der letzten aufgelaufen ist,
 * nach Projekten gegliedert. Gebündelt statt einzeln, damit die Post aus diesem
 * Werkzeug gelesen wird und nicht überblättert.
 *
 * Gibt zurück, wie viele Personen erreicht wurden – für den Prüfbericht.
 */
export async function sendeSammelmails(): Promise<{
  personen: number;
  meldungen: number;
  fehler: string[];
}> {
  const fehler: string[] = [];
  if (!mailEnabled()) return { personen: 0, meldungen: 0, fehler };

  const db = serviceClient();
  const { data, error } = await db
    .from('mail_queue')
    .select('id, empfaenger, projekt_name, text, created_at')
    .is('gesendet_am', null)
    .order('created_at', { ascending: true })
    .limit(2000);

  if (error) return { personen: 0, meldungen: 0, fehler: [error.message] };

  const offen = (data ?? []) as Array<{
    id: string;
    empfaenger: string;
    projekt_name: string | null;
    text: string;
    created_at: string;
  }>;
  if (!offen.length) return { personen: 0, meldungen: 0, fehler };

  // Je Person eine Mail, darin nach Projekt gegliedert.
  const jePerson = new Map<string, typeof offen>();
  for (const z of offen) {
    const liste = jePerson.get(z.empfaenger) ?? [];
    liste.push(z);
    jePerson.set(z.empfaenger, liste);
  }

  const vorlage = await ladeVorlage('sammelmail');
  let personen = 0;

  for (const [empfaenger, eintraege] of jePerson) {
    try {
      const jeProjekt = new Map<string, string[]>();
      for (const e of eintraege) {
        const name = e.projekt_name ?? 'Projekt';
        const liste = jeProjekt.get(name) ?? [];
        liste.push(e.text);
        jeProjekt.set(name, liste);
      }

      const bloecke = [...jeProjekt.entries()].map(
        ([projekt, zeilen]) =>
          `${projekt}:\n${zeilen.map((z) => `• ${z}`).join('\n')}`,
      );

      const werte = {
        anzahl: String(eintraege.length),
        projekte: String(jeProjekt.size),
        eintraege: bloecke.join('\n\n'),
        link: appBaseUrl(),
      };

      const subject = einsetzen(vorlage.betreff, werte).slice(0, 120);
      const text = einsetzen(vorlage.text, werte);
      const html = wrapHtml(
        eintraege.length === 1 ? 'Eine Neuigkeit' : `${eintraege.length} Neuigkeiten`,
        textZuHtml(text),
      );

      await send({ to: [empfaenger], subject, text, html, anLieferanten: true });
      personen += 1;

      await db
        .from('mail_queue')
        .update({ gesendet_am: new Date().toISOString() })
        .in(
          'id',
          eintraege.map((e) => e.id),
        );
    } catch (e) {
      fehler.push(
        `${empfaenger}: ${e instanceof Error ? e.message : 'unbekannter Fehler'}`,
      );
    }
  }

  return { personen, meldungen: offen.length, fehler };
}

// ---------------------------------------------------------------------------
// Vorschau für die Bearbeitung in der App
// ---------------------------------------------------------------------------

/**
 * Beispielwerte für die Vorschau.
 *
 * Bewusst erfundene, aber glaubwürdige Angaben: An "Reto Schmid" sieht man
 * sofort, wo der Name landet – an "{vorname}" nicht. Das Passwort ist ebenfalls
 * erfunden; ein echtes hätte in einer Vorschau nichts verloren.
 */
const VORSCHAU_WERTE: Record<VorlagenSchluessel, Record<string, string>> = {
  einladung: {
    vorname: 'Reto',
    name: 'Reto Schmid',
    firma: 'Elektro Meier AG',
    email: 'reto.schmid@elektro-meier.ch',
    passwort: 'Baustelle2026',
    link: appBaseUrl(),
  },
  benachrichtigung: {
    projekt: 'Dietikon',
    wer: 'Reto Schmid',
    was: 'hat To-Do "Zählerplatz freigeben" erstellt',
    link: appBaseUrl(),
  },
  update: {
    projekt: 'Dietikon',
    ort: 'Moosmattstrasse 24',
    eintraege: [
      '• Reto Schmid hat To-Do "Zählerplatz freigeben" erstellt',
      '• Peter Küng hat den Terminplan geändert',
      '• Anna Frei hat eine Offerte hochgeladen',
    ].join('\n'),
    link: appBaseUrl(),
  },
  sammelmail: {
    anzahl: '3',
    projekte: '2',
    eintraege:
      'Dietikon:\n'
      + '• Reto Schmid hat To-Do "Zählerplatz freigeben" angelegt\n'
      + '• Anna Frei hat zu To-Do "Gerüst stellen" kommentiert: "Kommt Montag"\n\n'
      + 'Solothurn:\n'
      + '• Peter Küng hat "Montage AC" im Terminplan geändert (12.–16.10.)',
    link: appBaseUrl(),
  },
  fristnah: {
    projekt: 'Dietikon',
    aufgabe: 'Zählerplatz freigeben',
    wann: 'in 2 Tagen',
    frist: '12.08.2026',
    link: appBaseUrl(),
  },
  fristheute: {
    projekt: 'Dietikon',
    aufgabe: 'Zählerplatz freigeben',
    frist: '12.08.2026',
    link: appBaseUrl(),
  },
  fristablauf: {
    projekt: 'Dietikon',
    aufgabe: 'Zählerplatz freigeben',
    frist: '12.08.2026',
    ueberfaellig: 'seit 3 Tagen',
    link: appBaseUrl(),
  },
};

/** Überschrift im Rahmen – die setzt die App, nicht die Vorlage. */
const VORSCHAU_TITEL: Record<VorlagenSchluessel, string> = {
  einladung: 'Zugriff auf die Baukoordination-App',
  benachrichtigung: 'Neue Aktivität in "Dietikon"',
  update: 'Update zu "Dietikon"',
  sammelmail: '3 Neuigkeiten',
  fristnah: 'Morgen fällig',
  fristheute: 'Heute fällig',
  fristablauf: 'Frist überschritten',
};

/**
 * Wie die Mail beim Empfänger aussieht – mit Rahmen, Logo und Fusszeile.
 *
 * In der Bearbeitung steht nur der nackte Text mit Platzhaltern; das sah anders
 * aus als die Post, die tatsächlich ankam. Hier läuft derselbe Weg wie beim
 * echten Versand: Platzhalter einsetzen, in HTML wandeln, in den Rahmen legen.
 * Ändert sich der Rahmen, ändert sich die Vorschau von selbst mit.
 */
export function baueVorschau(
  schluessel: VorlagenSchluessel,
  betreff: string,
  text: string,
): { betreff: string; html: string } {
  const werte = VORSCHAU_WERTE[schluessel];

  // Die Mahnung trägt zusätzlich einen roten Balken, den nicht die Vorlage
  // liefert, sondern der Versand – sonst fehlte er in der Vorschau.
  const banner =
    schluessel === 'fristablauf'
      ? `<div style="background:#FAE1DD;border-radius:8px;padding:12px 14px;margin:0 0 16px;">
      <strong style="color:#C0392B;font-size:14px;">Diese Aufgabe ist ${escapeHtml(werte.ueberfaellig)} überfällig.</strong>
    </div>`
      : '';

  return {
    betreff: einsetzen(betreff, werte),
    html: wrapHtml(
      VORSCHAU_TITEL[schluessel],
      banner + textZuHtml(einsetzen(text, werte)),
    ),
  };
}
