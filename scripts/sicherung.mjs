#!/usr/bin/env node
/**
 * Sicherung der Baukoordination – Dateien und Datenbank auf den eigenen Rechner.
 *
 * Warum das nötig ist, obwohl Supabase sichert: Die Sicherung von Supabase
 * liegt bei Supabase. Geht dort das Konto verloren, wird es versehentlich
 * gelöscht oder läuft die Rechnung aus, ist beides gleichzeitig weg – die
 * Daten und ihre Sicherung. Eine Kopie ist erst dann eine Sicherung, wenn sie
 * woanders liegt als das Original.
 *
 * Diese Sicherung ist zum Nachschauen und Wiederherstellen von Hand gedacht:
 * Die Dateien liegen danach als richtige Dateien auf der Platte, die Tabellen
 * als lesbares JSON. Für eine vollständige Wiederherstellung der Datenbank
 * samt Beziehungen und Regeln braucht es zusätzlich pg_dump – siehe
 * scripts/SICHERUNG.md.
 *
 * Aufruf:
 *   node scripts/sicherung.mjs
 *   node scripts/sicherung.mjs --ziel /Volumes/Stick/baukoordination
 *
 * Nötig sind NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY. Sie
 * werden aus .env.local gelesen, wenn sie nicht in der Umgebung stehen.
 */

import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const TABELLEN = [
  'access_audit',
  'activity',
  'activity_archiv',
  'admin_seed',
  'admins',
  'app_settings',
  'comment_kudos',
  'document_folders',
  'file_comments',
  'files',
  'mail_queue',
  'mail_templates',
  'milestone_template_items',
  'milestone_templates',
  'project_access',
  'project_admins',
  'project_contacts',
  'project_infos',
  'projects',
  'schedule_notes',
  'schedule_tasks',
  'supplier_sessions',
  'suppliers',
  'todo_comments',
  'todos',
];

const BUCKETS = ['project-files', 'avatars'];

/** Schlüssel aus .env.local nachladen, wenn sie nicht in der Umgebung stehen. */
async function umgebungLaden() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

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
 * Deshalb wird von Hand geblättert und in die Unterordner abgestiegen –
 * sonst fehlten in der Sicherung genau die Vorschaubilder, die in
 * <projekt>/thumbs liegen.
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
      // Ein Eintrag ohne id ist ein Ordner, keine Datei.
      if (eintrag.id) gefunden.push({ pfad, groesse: eintrag.metadata?.size ?? 0 });
      else gefunden.push(...(await alleObjekte(db, bucket, pfad)));
    }

    if (data.length < 100) break;
    versatz += data.length;
  }

  return gefunden;
}

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
  const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const ordner = resolve(process.cwd(), basis, stempel);

  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Sicherung nach ${ordner}\n`);

  // ---------------------------------------------------------------- Tabellen
  let zeilenGesamt = 0;
  const tabellenBericht = [];

  for (const tabelle of TABELLEN) {
    const { data, error } = await db.from(tabelle).select('*');

    if (error) {
      // Eine fehlende Tabelle ist kein Grund abzubrechen: Vielleicht ist eine
      // Migration nicht eingespielt. Der Rest der Sicherung ist trotzdem gültig.
      console.log(`  ${tabelle.padEnd(26)} übersprungen (${error.message})`);
      tabellenBericht.push({ tabelle, zeilen: null, fehler: error.message });
      continue;
    }

    const ziel = join(ordner, 'datenbank', `${tabelle}.json`);
    await mkdir(dirname(ziel), { recursive: true });
    await writeFile(ziel, JSON.stringify(data ?? [], null, 2), 'utf8');

    zeilenGesamt += (data ?? []).length;
    console.log(`  ${tabelle.padEnd(26)} ${String((data ?? []).length).padStart(6)} Zeilen`);
    tabellenBericht.push({ tabelle, zeilen: (data ?? []).length });
  }

  // ---------------------------------------------------------------- Dateien
  console.log('');
  let bytesGesamt = 0;
  let dateienGesamt = 0;
  const dateiFehler = [];

  for (const bucket of BUCKETS) {
    let objekte;
    try {
      objekte = await alleObjekte(db, bucket);
    } catch (e) {
      console.log(`  ${bucket}: nicht lesbar (${e.message})`);
      dateiFehler.push(`${bucket}: ${e.message}`);
      continue;
    }

    console.log(`  ${bucket}: ${objekte.length} Dateien`);

    for (const objekt of objekte) {
      const { data, error } = await db.storage.from(bucket).download(objekt.pfad);

      if (error || !data) {
        dateiFehler.push(`${bucket}/${objekt.pfad}: ${error?.message ?? 'leer'}`);
        continue;
      }

      const ziel = join(ordner, 'dateien', bucket, objekt.pfad);
      await mkdir(dirname(ziel), { recursive: true });
      await writeFile(ziel, Buffer.from(await data.arrayBuffer()));

      bytesGesamt += objekt.groesse;
      dateienGesamt += 1;
    }
  }

  // ---------------------------------------------------------------- Bericht
  const bericht = {
    erstellt: new Date().toISOString(),
    projekt: url,
    tabellen: tabellenBericht,
    zeilen_gesamt: zeilenGesamt,
    dateien_gesamt: dateienGesamt,
    bytes_gesamt: bytesGesamt,
    fehler: dateiFehler,
  };

  await writeFile(
    join(ordner, 'bericht.json'),
    JSON.stringify(bericht, null, 2),
    'utf8',
  );

  const mb = (bytesGesamt / 1024 / 1024).toFixed(1);
  console.log(
    `\nFertig: ${zeilenGesamt} Zeilen, ${dateienGesamt} Dateien (${mb} MB)`,
  );

  if (dateiFehler.length) {
    console.log(`\n${dateiFehler.length} Datei(en) konnten nicht geladen werden:`);
    for (const f of dateiFehler.slice(0, 10)) console.log(`  ${f}`);
    // Ausdrücklich ein Fehlschlag: Eine halbe Sicherung, die sich als ganze
    // ausgibt, ist gefährlicher als gar keine.
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nSicherung fehlgeschlagen:', e.message);
  process.exit(1);
});
