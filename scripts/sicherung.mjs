#!/usr/bin/env node
/**
 * Sicherung der Baukoordination – als lesbare Ordnerstruktur.
 *
 * Warum das nötig ist, obwohl Supabase sichert: Die Sicherung von Supabase
 * liegt bei Supabase. Geht das Konto verloren, wird es versehentlich gelöscht
 * oder läuft die Rechnung aus, ist beides gleichzeitig weg – die Daten und
 * ihre Sicherung. Eine Kopie ist erst dann eine Sicherung, wenn sie woanders
 * liegt als das Original.
 *
 * Diese Sicherung ist zum ANSCHAUEN gebaut, nicht zum Zurückspielen. Sie legt
 * je Projekt einen Ordner an, darin die Dateien unter ihren richtigen Namen
 * und die Inhalte der App als Textdateien, die sich ohne irgendein Programm
 * lesen lassen. Im schlimmsten Fall braucht man die Pläne und die Abmachungen,
 * nicht die App.
 *
 * Für das vollständige Zurückspielen der Datenbank gibt es daneben pg_dump –
 * siehe scripts/SICHERUNG.md.
 *
 * Einmal pro Tag genuegt: Wurde heute schon gesichert, endet das Skript
 * sofort wieder. Deshalb darf es bei jeder Anmeldung starten – wer den
 * Rechner dreimal am Tag hochfaehrt, bekommt trotzdem eine Sicherung und
 * nicht drei.
 *
 * Aufruf:
 *   node scripts/sicherung.mjs
 *   node scripts/sicherung.mjs --ziel "/Users/dominic/OneDrive/Baukoordination"
 *   node scripts/sicherung.mjs --erzwingen        (auch wenn heute schon)
 *
 * Nötig sind NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY. Sie
 * werden aus .env.local gelesen, wenn sie nicht in der Umgebung stehen.
 */

import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';

const TABELLEN = [
  'access_audit', 'activity', 'activity_archiv', 'admin_seed', 'admins',
  'app_settings', 'comment_kudos', 'document_folders', 'file_comments',
  'files', 'mail_queue', 'mail_templates', 'milestone_template_items',
  'milestone_templates', 'notify_pause', 'project_access', 'project_admins',
  'project_contacts', 'project_infos', 'projects', 'schedule_notes',
  'schedule_tasks', 'supplier_sessions', 'suppliers', 'todo_comments', 'todos',
];

/** Wie viele Sicherungen aufbewahrt werden, bevor die älteste weicht. */
const AUFBEWAHREN = 14;

// ---------------------------------------------------------------- Werkzeuge

/** Aus einem Namen einen gültigen Dateinamen machen – auf allen Systemen. */
function sauber(name, ersatz = 'ohne Namen') {
  const wert = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120)
    .trim();
  return wert || ersatz;
}

/** Datum lesbar: 24.09.2026. */
function datum(wert) {
  if (!wert) return '';
  const d = new Date(wert);
  if (Number.isNaN(d.getTime())) return String(wert);
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Datum mit Uhrzeit – für Protokoll und Kommentare. */
function zeitpunkt(wert) {
  if (!wert) return '';
  const d = new Date(wert);
  if (Number.isNaN(d.getTime())) return String(wert);
  return `${datum(wert)} ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Schlägt Namen zu Kennungen nach – für Zuständige und Urheber. */
function namensbuch(admins, suppliers) {
  const map = new Map();
  for (const a of admins) {
    map.set(`admin:${a.user_id}`, a.name || 'Unbekannt');
  }
  for (const s of suppliers) {
    const name = s.name?.trim() || s.firma?.trim() || 'Unbekannt';
    const mitFirma = s.firma?.trim() && s.name?.trim() ? `${name} (${s.firma.trim()})` : name;
    map.set(`supplier:${s.id}`, mitFirma);
    // Ohne Vorsatz kommt dieselbe Kennung ebenfalls vor.
    map.set(s.id, mitFirma);
  }
  map.set('internal', 'Swiss Solar Ventures AG');
  return (wert) => map.get(wert) ?? (wert ? `Unbekannt (${wert})` : 'niemand');
}

async function schreibe(pfad, inhalt) {
  await mkdir(dirname(pfad), { recursive: true });
  await writeFile(pfad, inhalt, 'utf8');
}

/** Schlüssel aus .env.local nachladen, wenn sie nicht in der Umgebung stehen. */
async function umgebungLaden() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  for (const datei of ['.env.local', '.env']) {
    try {
      const inhalt = await readFile(resolve(process.cwd(), datei), 'utf8');
      for (const zeile of inhalt.split('\n')) {
        const treffer = zeile.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!treffer) continue;
        const wert = treffer[2].replace(/^["']|["']$/g, '');
        if (!process.env[treffer[1]]) process.env[treffer[1]] = wert;
      }
    } catch {
      // Datei gibt es nicht – dann eben aus der Umgebung.
    }
  }
}

/**
 * Alle Objekte eines Ablageorts auflisten.
 *
 * Supabase listet nur einen Ordner auf einmal und höchstens 100 Einträge.
 * Deshalb wird von Hand geblättert und in die Unterordner abgestiegen – sonst
 * fehlten in der Sicherung genau die Vorschaubilder unter <projekt>/thumbs.
 */
async function alleObjekte(db, bucket, ordner = '') {
  const gefunden = [];
  let versatz = 0;

  for (;;) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(ordner, { limit: 100, offset: versatz, sortBy: { column: 'name', order: 'asc' } });

    if (error) throw new Error(`${bucket}/${ordner}: ${error.message}`);
    if (!data || !data.length) break;

    for (const eintrag of data) {
      const pfad = ordner ? `${ordner}/${eintrag.name}` : eintrag.name;
      if (eintrag.id) gefunden.push({ pfad, groesse: eintrag.metadata?.size ?? 0 });
      else gefunden.push(...(await alleObjekte(db, bucket, pfad)));
    }

    if (data.length < 100) break;
    versatz += data.length;
  }

  return gefunden;
}

// ------------------------------------------------------------- Textfassungen

function schreibeProjektinfos(projekt, infos, kontakte, zugeteilte, nenne) {
  const z = [`# ${projekt.name}`, ''];
  if (projekt.ort) z.push(`**Ort:** ${projekt.ort}`);
  if (projekt.status) z.push(`**Status:** ${projekt.status}`);
  z.push(`**Angelegt:** ${datum(projekt.created_at)}`, '');

  if (infos.length) {
    z.push('## Angaben zum Objekt', '');
    for (const i of infos) {
      z.push(`### ${i.titel || 'Ohne Titel'}`, '', i.text || '_leer_', '');
    }
  }

  if (kontakte.length) {
    z.push('## Kontakte vor Ort', '');
    for (const k of kontakte) {
      const teile = [k.name, k.firma, k.rolle].filter(Boolean).join(' · ');
      z.push(`- **${teile || 'Ohne Namen'}**`);
      if (k.kontakt) z.push(`  - Telefon: ${k.kontakt}`);
      if (k.email) z.push(`  - E-Mail: ${k.email}`);
      if (k.notiz) z.push(`  - ${k.notiz}`);
    }
    z.push('');
  }

  if (zugeteilte.length) {
    z.push('## Beteiligte Firmen', '');
    for (const s of zugeteilte) z.push(`- ${nenne(`supplier:${s}`)}`);
    z.push('');
  }

  return z.join('\n');
}

function schreibeTodos(todos, kommentare, nenne) {
  const z = ['# To-Dos', ''];
  const offen = todos.filter((t) => !t.done);
  const fertig = todos.filter((t) => t.done);

  const block = (liste, titel) => {
    if (!liste.length) return;
    z.push(`## ${titel} (${liste.length})`, '');
    for (const t of liste) {
      const zust = (t.assignees?.length ? t.assignees : [t.assigned_to])
        .filter(Boolean)
        .map(nenne)
        .join(', ');

      z.push(`### ${t.done ? '[x]' : '[ ]'} ${t.text}`);
      const merkmale = [
        t.due_date ? `Frist: ${datum(t.due_date)}` : null,
        zust ? `Zuständig: ${zust}` : null,
        t.meilenstein ? 'Meilenstein' : null,
        t.vertraulich ? 'vertraulich' : null,
        t.done_at ? `erledigt am ${datum(t.done_at)}${t.done_by ? ` von ${t.done_by}` : ''}` : null,
      ].filter(Boolean);
      if (merkmale.length) z.push('', `_${merkmale.join(' · ')}_`);

      const meine = (kommentare.get(t.id) ?? []).sort(
        (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
      );
      if (meine.length) {
        z.push('', '**Kommentare:**');
        for (const k of meine) {
          z.push(`- ${zeitpunkt(k.created_at)} – **${k.author || 'Unbekannt'}**: ${k.text}`);
        }
      }
      z.push('');
    }
  };

  block(offen, 'Offen');
  block(fertig, 'Erledigt');
  if (!todos.length) z.push('_Keine To-Dos erfasst._');
  return z.join('\n');
}

function schreibeTerminplan(projekt, arbeiten, notizen, nenne) {
  const z = ['# Terminplan', ''];
  if (projekt.schedule_start || projekt.schedule_end) {
    z.push(`**Zeitraum:** ${datum(projekt.schedule_start)} – ${datum(projekt.schedule_end)}`, '');
  }
  if (!arbeiten.length) {
    z.push('_Keine Arbeiten erfasst._');
    return z.join('\n');
  }

  z.push('| Wer | Arbeit | Von | Bis | Zuständig |', '|---|---|---|---|---|');
  for (const a of arbeiten) {
    const zust = (a.owners?.length ? a.owners : [a.owner]).filter(Boolean).map(nenne).join(', ');
    z.push(
      `| ${a.responsible ?? ''} | ${a.label} | ${datum(a.start_date)} | ${datum(a.end_date)} | ${zust} |`,
    );
  }
  z.push('');

  const mitNotiz = arbeiten.filter((a) => (notizen.get(a.id) ?? []).length);
  if (mitNotiz.length) {
    z.push('## Rückmeldungen und Terminvorschläge', '');
    for (const a of mitNotiz) {
      z.push(`### ${a.label}`, '');
      for (const n of notizen.get(a.id)) {
        z.push(`- ${zeitpunkt(n.created_at)} – **${n.author_name || 'Unbekannt'}**: ${n.text}`);
      }
      z.push('');
    }
  }
  return z.join('\n');
}

function schreibeProtokoll(eintraege) {
  const z = ['# Protokoll', ''];
  if (!eintraege.length) {
    z.push('_Keine Einträge._');
    return z.join('\n');
  }
  for (const e of eintraege) {
    z.push(`- ${zeitpunkt(e.created_at)} – ${e.icon ?? ''} **${e.actor_name}** ${e.text}`);
  }
  return z.join('\n');
}

// ------------------------------------------------------------------- Hauptteil

async function main() {
  await umgebungLaden();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    console.error(
      'Es fehlen NEXT_PUBLIC_SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY.\n'
      + 'Beide stehen in Vercel unter Settings → Environment Variables.',
    );
    process.exit(1);
  }

  const zielIndex = process.argv.indexOf('--ziel');
  const basis = zielIndex > -1 ? process.argv[zielIndex + 1] : 'sicherung';
  // Ortszeit und nicht UTC: Um halb neun abends waere in UTC schon der
  // naechste Tag, und die Sicherung von Dienstagabend hiesse Mittwoch.
  const heute = new Date();
  const stempel = [
    heute.getFullYear(),
    String(heute.getMonth() + 1).padStart(2, '0'),
    String(heute.getDate()).padStart(2, '0'),
  ].join('-');

  const ordner = resolve(process.cwd(), basis, `Baukoordination-${stempel}`);

  /**
   * Schon heute gesichert? Dann nichts tun.
   *
   * Damit darf das Skript bei jeder Anmeldung starten: Wer den Rechner
   * dreimal am Tag hochfaehrt, bekommt trotzdem eine Sicherung und nicht
   * drei. Und wer ihn tagelang nicht einschaltet, bekommt die Sicherung beim
   * naechsten Einschalten – ohne dass jemand daran denken muss.
   *
   * Mit --erzwingen laesst es sich uebergehen, etwa um nach einer grossen
   * Aenderung sofort noch einmal zu sichern.
   */
  const erzwingen = process.argv.includes('--erzwingen');
  if (!erzwingen) {
    try {
      const bericht = JSON.parse(await readFile(join(ordner, 'bericht.json'), 'utf8'));
      if (bericht?.erstellt) {
        console.log(
          `Heute wurde bereits gesichert (${new Date(bericht.erstellt).toLocaleString('de-CH')}).`,
        );
        console.log(`  ${ordner}`);
        console.log('Nochmals sichern: --erzwingen anhaengen.');
        return;
      }
    } catch {
      // Kein Bericht, kein Ordner, unlesbar – dann eben sichern. Im Zweifel
      // lieber eine Sicherung zu viel als eine ausgelassene.
    }
  }

  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Sicherung nach ${ordner}\n`);

  // --------------------------------------------------------------- Tabellen
  const daten = {};
  let zeilenGesamt = 0;

  for (const tabelle of TABELLEN) {
    const { data, error } = await db.from(tabelle).select('*');
    if (error) {
      console.log(`  ${tabelle.padEnd(26)} übersprungen (${error.message})`);
      daten[tabelle] = [];
      continue;
    }
    daten[tabelle] = data ?? [];
    zeilenGesamt += daten[tabelle].length;
    await schreibe(join(ordner, '_Datenbank', `${tabelle}.json`), JSON.stringify(data ?? [], null, 2));
  }
  console.log(`  Datenbank: ${zeilenGesamt} Zeilen in ${TABELLEN.length} Tabellen\n`);

  const nenne = namensbuch(daten.admins, daten.suppliers);

  // Hilfslisten je Projekt
  const projekte = daten.projects;
  const nachProjekt = (liste, feld = 'project_id') => {
    const map = new Map();
    for (const z of liste) {
      const k = z[feld];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(z);
    }
    return map;
  };

  const todosJe = nachProjekt(daten.todos.filter((t) => !t.deleted_at));
  const dateienJe = nachProjekt(daten.files.filter((f) => !f.deleted_at));
  const planJe = nachProjekt(daten.schedule_tasks);
  const infosJe = nachProjekt(daten.project_infos);
  const kontakteJe = nachProjekt(daten.project_contacts);
  const protokollJe = nachProjekt(daten.activity);
  const zugangJe = nachProjekt(daten.project_access);

  const kommentareJe = new Map();
  for (const k of daten.todo_comments) {
    if (!kommentareJe.has(k.todo_id)) kommentareJe.set(k.todo_id, []);
    kommentareJe.get(k.todo_id).push(k);
  }
  const notizenJe = new Map();
  for (const n of daten.schedule_notes) {
    if (!notizenJe.has(n.task_id)) notizenJe.set(n.task_id, []);
    notizenJe.get(n.task_id).push(n);
  }

  const ordnerName = new Map(daten.document_folders.map((f) => [f.id, f]));

  // ---------------------------------------------------------- Je Projekt
  const fehler = [];
  let dateienGesamt = 0;
  let bytesGesamt = 0;

  for (const p of projekte) {
    const basisPfad = join(ordner, sauber(p.name, 'Projekt ohne Namen'));
    const todos = (todosJe.get(p.id) ?? []).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const plan = (planJe.get(p.id) ?? []).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const protokoll = (protokollJe.get(p.id) ?? []).sort(
      (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
    );
    const zugeteilt = (zugangJe.get(p.id) ?? []).map((z) => z.supplier_id);

    await schreibe(
      join(basisPfad, 'Projektinfos.md'),
      schreibeProjektinfos(p, infosJe.get(p.id) ?? [], kontakteJe.get(p.id) ?? [], zugeteilt, nenne),
    );
    await schreibe(join(basisPfad, 'To-Dos.md'), schreibeTodos(todos, kommentareJe, nenne));
    await schreibe(join(basisPfad, 'Terminplan.md'), schreibeTerminplan(p, plan, notizenJe, nenne));
    await schreibe(join(basisPfad, 'Protokoll.md'), schreibeProtokoll(protokoll));

    // Dateien an ihren richtigen Platz, unter ihrem richtigen Namen.
    const dateien = dateienJe.get(p.id) ?? [];
    const vergeben = new Set();

    for (const f of dateien) {
      let unterordner;
      if (f.offer_folder) {
        const namen = {
          auftragsbestaetigung: 'Auftragsbestätigungen',
          nachtrag: 'Nachträge',
          offerte: 'Offerten (früher)',
          kostenschaetzung: 'Kostenschätzungen (früher)',
          richtofferte: 'Richtofferten (früher)',
        };
        unterordner = namen[f.offer_folder] ?? `Offerten – ${f.offer_folder}`;
      } else if (f.document_folder) {
        const o = ordnerName.get(f.document_folder);
        const eltern = o?.parent_id ? ordnerName.get(o.parent_id) : null;
        unterordner = join(
          'Dokumente',
          ...(eltern ? [sauber(eltern.name)] : []),
          sauber(o?.name ?? 'Ohne Ordner'),
        );
      } else if ((f.mime_type ?? '').startsWith('image/')) {
        unterordner = 'Fotos';
      } else {
        unterordner = 'Dateien';
      }

      // Der gespeicherte Name trägt meist keine Endung – die steckt im Pfad.
      const endung = extname(f.name) || extname(f.storage_path ?? '') || '';
      let name = `${sauber(f.name.replace(/\.[^.]+$/, ''), 'Datei')}${endung}`;
      const schluessel = `${unterordner}/${name.toLowerCase()}`;
      if (vergeben.has(schluessel)) {
        name = `${sauber(f.name.replace(/\.[^.]+$/, ''))} (${f.id.slice(0, 6)})${endung}`;
      }
      vergeben.add(schluessel);

      const { data, error } = await db.storage.from('project-files').download(f.storage_path);
      if (error || !data) {
        fehler.push(`${p.name} / ${f.name}: ${error?.message ?? 'leer'}`);
        continue;
      }

      const ziel = join(basisPfad, unterordner, name);
      await mkdir(dirname(ziel), { recursive: true });
      await writeFile(ziel, Buffer.from(await data.arrayBuffer()));
      dateienGesamt += 1;
      bytesGesamt += f.size_bytes ?? 0;
    }

    console.log(
      `  ${p.name.padEnd(28)} ${String(todos.length).padStart(3)} To-Dos, `
      + `${String(plan.length).padStart(3)} Arbeiten, ${String(dateien.length).padStart(3)} Dateien`,
    );
  }

  // Profilbilder liegen ausserhalb der Projekte.
  try {
    for (const o of await alleObjekte(db, 'avatars')) {
      const { data } = await db.storage.from('avatars').download(o.pfad);
      if (!data) continue;
      const ziel = join(ordner, '_Bilder', o.pfad);
      await mkdir(dirname(ziel), { recursive: true });
      await writeFile(ziel, Buffer.from(await data.arrayBuffer()));
      dateienGesamt += 1;
    }
  } catch (e) {
    fehler.push(`Profilbilder: ${e.message}`);
  }

  // ------------------------------------------------------------- Beipackzettel
  const mb = (bytesGesamt / 1024 / 1024).toFixed(1);
  await schreibe(
    join(ordner, 'LIESMICH.md'),
    [
      `# Sicherung Baukoordination – ${datum(new Date())}`,
      '',
      'Je Projekt ein Ordner. Darin:',
      '',
      '- **Projektinfos.md** – Objektangaben, Kontakte vor Ort, beteiligte Firmen',
      '- **To-Dos.md** – alle Aufgaben mit Frist, Zuständigen und Kommentaren',
      '- **Terminplan.md** – Balkenplan als Tabelle, mit Rückmeldungen',
      '- **Protokoll.md** – was wann von wem geschehen ist',
      '- **Auftragsbestätigungen/**, **Nachträge/** – die Verträge',
      '- **Dokumente/** – wie in der App gegliedert',
      '- **Fotos/**, **Dateien/** – der Rest',
      '',
      'Daneben **_Datenbank/** mit allen Tabellen als JSON und **_Bilder/** mit',
      'den Profilbildern.',
      '',
      'Die .md-Dateien sind Text und lassen sich mit jedem Editor öffnen; in',
      'Word oder einem Markdown-Programm sehen sie formatiert aus.',
      '',
      '## Was hier NICHT drin ist',
      '',
      'Passwörter der Lieferanten stehen nur als Prüfwert in der Datenbank und',
      'sind aus dieser Sicherung nicht zurückzurechnen. Für das vollständige',
      'Zurückspielen der Datenbank braucht es zusätzlich einen pg_dump – siehe',
      'scripts/SICHERUNG.md im Programmcode.',
      '',
      `## Umfang`,
      '',
      `- Projekte: ${projekte.length}`,
      `- Dateien: ${dateienGesamt} (${mb} MB)`,
      `- Datenbankzeilen: ${zeilenGesamt}`,
      fehler.length ? `- **Nicht geladen: ${fehler.length}**` : '- Ohne Fehler',
    ].join('\n'),
  );

  // ------------------------------------------------- Alte Sicherungen räumen
  try {
    const alle = (await readdir(resolve(process.cwd(), basis), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name.startsWith('Baukoordination-'))
      .map((e) => e.name)
      .sort();

    for (const alt of alle.slice(0, Math.max(0, alle.length - AUFBEWAHREN))) {
      await rm(resolve(process.cwd(), basis, alt), { recursive: true, force: true });
      console.log(`  alte Sicherung entfernt: ${alt}`);
    }
  } catch {
    // Aufräumen ist Kür. Schlägt es fehl, ist die neue Sicherung trotzdem gut.
  }

  console.log(`\nFertig: ${projekte.length} Projekte, ${dateienGesamt} Dateien (${mb} MB)`);

  if (fehler.length) {
    console.log(`\n${fehler.length} Datei(en) konnten nicht geladen werden:`);
    for (const f of fehler.slice(0, 10)) console.log(`  ${f}`);
    // Ausdrücklich ein Fehlschlag: Eine halbe Sicherung, die sich als ganze
    // ausgibt, ist gefährlicher als gar keine.
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nSicherung fehlgeschlagen:', e.message);
  process.exit(1);
});
