-- =============================================================================
-- Baukoordination – Migration 26: Glocke pro Person leeren
--
-- Die Glocke zeigt das Projektprotokoll. Bisher liess sie sich nur im eigenen
-- Browser wegräumen – wechselte man das Gerät, war alles wieder da, und für
-- andere liess sich gar nichts aufräumen.
--
-- Aus dem Aufbau der App liegen bei allen Beteiligten hunderte Einträge in der
-- Glocke, die niemanden mehr interessieren. Gelöscht werden dürfen sie nicht:
-- Am Protokoll hängen Fotos, Offerten und Terminänderungen, und das Register
-- "Aktivität" lebt davon. Was fehlt, ist eine Marke je Person – "alles bis
-- hierhin habe ich gesehen".
--
-- Genau die kommt hier dazu. Der Eintrag selbst bleibt unangetastet; er wird
-- für diese eine Person nur nicht mehr in der Glocke gezeigt.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

alter table public.admins
  add column if not exists glocke_geleert_bis timestamptz;

alter table public.suppliers
  add column if not exists glocke_geleert_bis timestamptz;

comment on column public.admins.glocke_geleert_bis is
  'Bis zu diesem Zeitpunkt gilt die Glocke als geleert. Nur eine Anzeigemarke – '
  'am Protokoll ändert sie nichts.';

comment on column public.suppliers.glocke_geleert_bis is
  'Bis zu diesem Zeitpunkt gilt die Glocke als geleert. Nur eine Anzeigemarke – '
  'am Protokoll ändert sie nichts.';

-- ---------------------------------------------------------------------------
-- Einmalig: die Glocke aller anderen leeren, die eigene stehen lassen.
--
-- Trage unten deine eigene Adresse ein. Alle Lieferanten und alle übrigen
-- Personen der Swiss Solar Ventures AG starten damit bei null; du behältst
-- deinen Verlauf.
--
-- Dasselbe geht danach jederzeit in der App: Glocke öffnen, "Alle anzeigen",
-- dann "Für alle ausser mir leeren".
-- ---------------------------------------------------------------------------

update public.admins
   set glocke_geleert_bis = now()
 where lower(coalesce(email, '')) <> lower('dominic.maag@swiss-sv.ch');

update public.suppliers
   set glocke_geleert_bis = now();

-- Kontrolle: bei dir muss die Spalte leer bleiben, bei allen anderen steht ein
-- Zeitpunkt.
--   select name, email, glocke_geleert_bis from public.admins order by name;
--   select name, firma, glocke_geleert_bis from public.suppliers order by firma;
