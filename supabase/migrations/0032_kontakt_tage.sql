-- =============================================================================
-- Baukoordination – Migration 32: An welchen Tagen jemand vor Ort ist
--
-- Der Hauswart ist am Dienstag und Donnerstag da, die Bauleitung nur montags.
-- Bisher stand das – wenn überhaupt – in der Notiz, und wer am Mittwoch vor der
-- Tür stand, rief trotzdem an.
--
-- Neu hängen die Tage am Kontakt: 1 = Montag bis 7 = Sonntag, wie ISO es zählt.
--
-- Leer oder gar nichts heisst ausdrücklich "immer vor Ort" und nicht "nie".
-- Das ist die richtige Voreinstellung: Die allermeisten Zeilen bleiben leer,
-- und ein Hauswart, der bei uns als "nie da" gälte, wäre schlimmer als einer
-- ohne Angabe. Genau deshalb bleibt die Spalte auch nullable statt mit einem
-- leeren Feld belegt – vorhandene Zeilen sind damit sofort richtig.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0029 voraus.
-- =============================================================================

alter table public.project_contacts
  add column if not exists tage smallint[];

-- Nur echte Wochentage. Eine 0 oder eine 9 wäre nirgends anzuzeigen und würde
-- still verschwinden – dann lieber hier abgelehnt, wo man den Fehler noch sieht.
alter table public.project_contacts
  drop constraint if exists project_contacts_tage_gueltig;

alter table public.project_contacts
  add constraint project_contacts_tage_gueltig
  check (tage is null or tage <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);

comment on column public.project_contacts.tage is
  'Wochentage, an denen die Person vor Ort ist: 1 = Montag … 7 = Sonntag. '
  'Null oder leer heisst "immer vor Ort", nicht "nie".';

-- Kontrolle: Wer ist wann da?
--   select p.name as projekt, k.rolle, k.name,
--          coalesce(k.tage::text, 'immer') as tage
--     from public.project_contacts k
--     join public.projects p on p.id = k.project_id
--    order by p.name, k.sortierung;
