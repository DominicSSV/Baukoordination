-- =============================================================================
-- Baukoordination – Daten 11: Terminplan „Berg“ aus Terminplan_Berg.xlsx
--
-- Übernimmt den Excel-Balkenplan (Andhauserstrasse 52a, Berg) 1:1 in die App:
--   * Zeitraum des Plans wie im Excel: 27.07.2026 bis 13.12.2026
--   * alle Balken mit Original-Datum und Original-Farbe
--   * Zuständig ist überall Dominic Maag (im Excel „Projektleitung“)
--
-- Im Supabase SQL-Editor ausführen. Darf mehrfach laufen: der Terminplan von
-- „Berg“ wird jedes Mal frisch aufgebaut.
--
-- Voraussetzung: 0006 und 0008 sind eingespielt (schedule_tasks + owner).
-- =============================================================================

do $$
declare
  v_projekt uuid;
  v_owner   text;
begin
  select id into v_projekt
    from public.projects
   where name ilike 'Berg'
   order by created_at
   limit 1;

  if v_projekt is null then
    raise exception 'Kein Projekt mit dem Namen „Berg“ gefunden – bitte zuerst anlegen.';
  end if;

  -- Zuständiger: Dominic Maag. Fehlt der Eintrag, bleibt die Spalte leer und
  -- der Plan funktioniert trotzdem – nur ohne Gesicht auf der linken Seite.
  select 'admin:' || user_id into v_owner
    from public.admins
   where lower(email) = 'dominic.maag@swiss-sv.ch'
   limit 1;

  -- Zeitachse wie im Excel.
  update public.projects
     set schedule_start = date '2026-07-27',
         schedule_end   = date '2026-12-13'
   where id = v_projekt;

  -- Sauberer Neuaufbau, damit das Skript wiederholbar bleibt.
  delete from public.schedule_tasks where project_id = v_projekt;

  insert into public.schedule_tasks
    (project_id, responsible, owner, label, start_date, end_date, color, order_index)
  values
    -- Gärtner
    (v_projekt, 'Gärtner', v_owner, 'Grabarbeiten',
     date '2026-08-11', date '2026-08-14', '#00B0F0',  0),
    (v_projekt, 'Gärtner', v_owner, 'Kernbohrungen',
     date '2026-08-13', date '2026-08-13', '#E36C0A',  1),

    -- Kies
    (v_projekt, 'Kies', v_owner, 'Gerüst stellen',
     date '2026-08-13', date '2026-08-14', '#C00000', 10),
    (v_projekt, 'Kies', v_owner, 'Gerüst stellen',
     date '2026-09-14', date '2026-09-18', '#C00000', 11),
    (v_projekt, 'Kies', v_owner, 'IBN',
     date '2026-09-10', date '2026-09-10', '#7030A0', 12),

    -- Kran
    (v_projekt, 'Kran', v_owner, 'Kran Einsatz',
     date '2026-08-18', date '2026-08-18', '#FFC000', 20),
    (v_projekt, 'Kran', v_owner, 'Kran Einsatz',
     date '2026-08-31', date '2026-08-31', '#FFC000', 21),

    -- Arbeiten Dach
    (v_projekt, 'Arbeiten Dach', v_owner, 'Montage Module Dach',
     date '2026-08-18', date '2026-08-21', '#0070C0', 30),
    (v_projekt, 'Arbeiten Dach', v_owner, 'Montage Module Dach',
     date '2026-08-24', date '2026-08-28', '#0070C0', 31),
    (v_projekt, 'Arbeiten Dach', v_owner, 'Montage Module Dach',
     date '2026-08-31', date '2026-09-03', '#0070C0', 32),

    -- PV
    (v_projekt, 'PV', v_owner, 'AC Installationen',
     date '2026-08-24', date '2026-08-28', '#00B050', 40),
    (v_projekt, 'PV', v_owner, 'AC Installationen',
     date '2026-08-31', date '2026-09-03', '#00B050', 41);

  raise notice 'Terminplan „Berg“ mit 12 Balken gefüllt.';
end $$;

-- Kontrolle:
--   select responsible, label, start_date, end_date, color
--     from public.schedule_tasks
--    where project_id = (select id from public.projects where name ilike 'Berg')
--    order by order_index;
