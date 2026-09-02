-- =============================================================================
-- Baukoordination – Migration 33: Protokoll und Glocke bei null starten
--
-- Einmalige Aufräumaktion nach der Aufbauphase.
--
-- Beim Einrichten der App sind tausende Protokolleinträge entstanden: Testdaten,
-- verschobene Aufgaben, hochgeladene und wieder gelöschte Dateien, 168 auf
-- einmal übernommene Meilensteine. Für den Betrieb ist davon nichts mehr wert –
-- und im Register "Aktivität" wie in der Glocke steht es allen im Weg.
--
-- Deshalb geht hier alles weg, was bisher protokolliert wurde. Ab dem Ausführen
-- schreibt die App wieder mit, und zwar von null an.
--
-- ACHTUNG: Das ist nicht rückgängig zu machen.
--
-- Was NICHT verloren geht: Projekte, Aufgaben, Dateien, Offerten, Termine,
-- Kommentare, Kontakte, Projektinfos, Lieferanten und Passwörter. Am Protokoll
-- hängt nichts davon – es ist eine reine Mitschrift. Verloren geht nur die
-- Mitschrift selbst: wer wann was gemacht hat.
--
-- Wer sie doch behalten will, führt vorher die auskommentierte Sicherung ganz
-- unten aus. Sie kostet eine Zeile und legt eine Kopie in einer eigenen Tabelle
-- ab, die die App nicht anrührt.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich –
-- beim zweiten Mal ist einfach schon nichts mehr da.
-- Setzt Migration 0026 voraus.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Das Protokoll aller Projekte leeren.
--
-- Kein "where": Es geht um alle Projekte, so wie gewünscht. Auf die Tabelle
-- verweist nichts, es bleiben also keine losen Enden zurück.
-- ---------------------------------------------------------------------------

delete from public.activity;

-- ---------------------------------------------------------------------------
-- 2. Die Glocke bei allen auf null setzen – bei uns wie bei den Lieferanten.
--
-- Nach Schritt 1 ist ohnehin nichts mehr da, was sie anzeigen könnte. Die
-- Marke wird trotzdem gesetzt, damit auch "Alle anzeigen" nichts aus der
-- Aufbauphase hervorholt, falls doch noch etwas übrig sein sollte.
--
-- Anders als bei Migration 0026 ist diesmal niemand ausgenommen: Es soll bei
-- allen gleich weitergehen, auch bei Dominic.
-- ---------------------------------------------------------------------------

update public.admins    set glocke_geleert_bis = now();
update public.suppliers set glocke_geleert_bis = now();

-- ---------------------------------------------------------------------------
-- Kontrolle: beide Zahlen müssen 0 sein, und in der Glocke steht "Nichts Neues".
--   select count(*) as eintraege from public.activity;
--   select count(*) as ohne_marke from public.admins where glocke_geleert_bis is null;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Optional, VOR dem Löschen auszuführen: eine Kopie zum Nachschlagen.
--
-- Die Tabelle gehört nicht zur App; sie wird nie gelesen und nie geschrieben.
-- Wer sie später nicht mehr braucht: drop table public.activity_archiv;
--
--   create table if not exists public.activity_archiv as
--     select *, now() as archiviert_am from public.activity;
--   alter table public.activity_archiv enable row level security;
--   -- Ohne Policy kommt niemand ausser dem Dienstschlüssel daran. Genau so
--   -- soll es sein: Das Archiv ist zum Nachschlagen in Supabase, nicht für
--   -- die App.
-- ---------------------------------------------------------------------------
