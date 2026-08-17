-- =============================================================================
-- Baukoordination – Daten 20: Terminplan Dietikon, Moosmattstrasse 24
--
-- Übernimmt den Excel-Balkenplan 1:1 in die App:
--   * Zeitachse wie im Excel: 31.08.2026 bis 27.09.2026 (KW36 bis KW39)
--   * alle 13 Arbeiten mit Original-Datum
--   * Gegliedert nach der Spalte [Firma] – so ordnet die App den Plan, und so
--     sieht man auf der Baustelle sofort, wer wann dran ist. Die blauen
--     Zwischenüberschriften des Excels (Logistik & Gerüst, AC-Installationen …)
--     haben in der App keine Entsprechung; die Reihenfolge bleibt erhalten.
--   * Zuständig ist überall Dominic Maag – je Zeile in der App änderbar.
--
-- Gibt es noch kein Projekt in Dietikon, legt das Skript eines an.
-- Stimmt die Strasse nicht, hier oben korrigieren und neu ausführen.
--
-- Im Supabase SQL-Editor ausführen. Darf mehrfach laufen: der Terminplan wird
-- jedes Mal frisch aufgebaut.
--
-- Voraussetzung: 0006 und 0008 sind eingespielt (schedule_tasks + owner).
-- =============================================================================

do $$
declare
  v_name    text := 'Dietikon';
  v_ort     text := 'Moosmattstrasse 24';
  v_projekt uuid;
  v_owner   text;
begin
  -- Bestehendes Projekt suchen: erst über den Namen, dann über die Adresse.
  -- So trifft es auch dann, wenn es in der App anders heisst.
  select id into v_projekt
    from public.projects
   where name ilike '%dietikon%'
      or ort  ilike '%dietikon%'
      or ort  ilike '%moosmatt%'
   order by created_at
   limit 1;

  if v_projekt is null then
    insert into public.projects (name, ort)
    values (v_name, v_ort)
    returning id into v_projekt;
    raise notice 'Projekt „% (%)" neu angelegt.', v_name, v_ort;
  else
    raise notice 'Bestehendes Projekt verwendet: %', v_projekt;
  end if;

  -- Zuständiger: Dominic Maag. Fehlt der Eintrag, bleibt die Spalte leer und
  -- der Plan funktioniert trotzdem – nur ohne Gesicht auf der linken Seite.
  select 'admin:' || user_id into v_owner
    from public.admins
   where lower(email) = 'dominic.maag@swiss-sv.ch'
   limit 1;

  -- Zeitachse wie im Excel: KW36 bis KW39.
  update public.projects
     set schedule_start = date '2026-08-31',
         schedule_end   = date '2026-09-27'
   where id = v_projekt;

  -- Sauberer Neuaufbau, damit das Skript wiederholbar bleibt.
  delete from public.schedule_tasks where project_id = v_projekt;

  insert into public.schedule_tasks
    (project_id, responsible, owner, label, start_date, end_date, color, order_index)
  values
    -- Logistik & Gerüst
    (v_projekt, 'gp-Group', v_owner, 'Gerüstturm erstellen',
     date '2026-09-04', date '2026-09-04', '#FFC000',  0),
    (v_projekt, 'gp-Group', v_owner, 'Gerüstturm demontieren',
     date '2026-09-18', date '2026-09-18', '#FFC000',  1),

    (v_projekt, 'Sidler Transport', v_owner,
     'Anlieferung WR + WR-Schrank + Kabel usw.',
     date '2026-09-07', date '2026-09-07', '#FFC000', 10),

    -- Montagearbeiten UK
    (v_projekt, 'Convoltas + Smartvolt', v_owner, 'Kraneinsatz SmartSolarBox',
     date '2026-09-07', date '2026-09-07', '#FFC000', 20),
    (v_projekt, 'Convoltas + Smartvolt', v_owner, 'Montage SmartSolarBox',
     date '2026-09-07', date '2026-09-07', '#FFC000', 21),

    -- DC-Leitungsführung + Kabel + WR, dann Inbetriebnahme
    (v_projekt, 'Convoltas AG', v_owner, 'Montage Schrank + WR',
     date '2026-09-08', date '2026-09-08', '#FFC000', 30),
    (v_projekt, 'Convoltas AG', v_owner, 'Kabeltrasse & Rohre montieren',
     date '2026-09-09', date '2026-09-09', '#FFC000', 31),
    (v_projekt, 'Convoltas AG', v_owner, 'Kabel ziehen / verstringen',
     date '2026-09-10', date '2026-09-10', '#FFC000', 32),
    (v_projekt, 'Convoltas AG', v_owner, 'Inbetriebnahme',
     date '2026-09-17', date '2026-09-17', '#FFC000', 33),

    -- AC-Installationen
    (v_projekt, 'Melintec', v_owner, 'Umbau Hauptverteilung',
     date '2026-09-07', date '2026-09-07', '#FFC000', 40),
    (v_projekt, 'Melintec', v_owner, 'Kernbohrungen',
     date '2026-09-07', date '2026-09-07', '#FFC000', 41),
    (v_projekt, 'Melintec', v_owner, 'DC-Trasse an Fassade montieren',
     date '2026-09-09', date '2026-09-09', '#FFC000', 42),
    (v_projekt, 'Melintec', v_owner, 'AC-Installationen',
     date '2026-09-09', date '2026-09-11', '#FFC000', 43);
end;
$$;

-- Kontrolle:
--   select p.name, p.ort, p.schedule_start, p.schedule_end,
--          t.responsible, t.label, t.start_date, t.end_date
--     from public.schedule_tasks t
--     join public.projects p on p.id = t.project_id
--    where p.ort ilike '%moosmatt%' or p.name ilike '%dietikon%'
--    order by t.order_index;
