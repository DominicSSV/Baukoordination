-- =============================================================================
-- Baukoordination – Daten 39: Terminplan Tägerwilen – PVA
--
-- ACHTUNG, GESCHICHTE DIESER DATEI: Die erste Fassung suchte das Projekt über
-- "%tägerwilen%" und nahm das älteste Ergebnis. In Tägerwilen gibt es aber zwei
-- Projekte – PVA und BESS – und getroffen wurde BESS. Dessen Terminplan wurde
-- dabei geleert. Genau dafür ist unten die Sperre eingebaut.
--
-- Übernimmt aus dem Excel-Balkenplan NUR die Arbeiten von Convoltas AG und
-- Melintec AG. Brenner, Covra Metall, Kunz Bau, Ammann, MABBA, Rugag, Ziegler
-- Weber und die übrigen Zeilen bleiben ausdrücklich draussen.
--
-- Zeitachse: KW43 bis KW48, also 19.10.2026 bis 27.11.2026.
--
-- ABLESEGENAUIGKEIT: Im Excel liegen die Balken auf ganzen Kalenderwochen.
-- Hier steht deshalb je Arbeit Montag bis Freitag der betreffenden Woche. Ist
-- eine Arbeit in Wirklichkeit kürzer, lässt sie sich in der App mit zwei
-- Klicks zurechtziehen – oder hier oben ändern und das Skript neu ausführen.
--
-- Im Supabase SQL-Editor ausführen. Darf mehrfach laufen: der Terminplan
-- dieses einen Projekts wird jedes Mal frisch aufgebaut.
--
-- Voraussetzung: 0006, 0008 und 0022 sind eingespielt.
-- =============================================================================

do $$
declare
  v_projekt uuid;
  v_treffer int;
  v_liste   text;
  v_owner   text;
  v_besitz  text[];
begin
  -- -------------------------------------------------------------------------
  -- Sperre: Es muss genau ein Projekt passen.
  --
  -- Gesucht wird nach Tägerwilen UND PVA. BESS wird zusätzlich ausdrücklich
  -- ausgeschlossen – doppelt, weil unten gelöscht wird und ein Fehlgriff hier
  -- einen fremden Terminplan kostet. Passt nicht genau eines, bricht das
  -- Skript ab und rührt nichts an.
  -- -------------------------------------------------------------------------
  select count(*), string_agg(name, ' | ' order by name)
    into v_treffer, v_liste
    from public.projects
   where (name ilike '%tägerwilen%' or name ilike '%taegerwilen%'
          or ort ilike '%tägerwilen%' or ort ilike '%taegerwilen%')
     and name ilike '%pva%'
     and name not ilike '%bess%';

  if v_treffer <> 1 then
    raise exception
      'Abbruch: % Projekte passen auf "Tägerwilen ... PVA" (%). Es wurde nichts geändert. Bitte den genauen Projektnamen in dieses Skript eintragen.',
      v_treffer, coalesce(v_liste, 'keines gefunden');
  end if;

  select id into v_projekt
    from public.projects
   where (name ilike '%tägerwilen%' or name ilike '%taegerwilen%'
          or ort ilike '%tägerwilen%' or ort ilike '%taegerwilen%')
     and name ilike '%pva%'
     and name not ilike '%bess%';

  raise notice 'Projekt gefunden: %', v_projekt;

  -- Zuständiger. Fehlt der Eintrag, bleibt die Spalte leer und der Plan
  -- funktioniert trotzdem – nur ohne Gesicht auf der linken Seite.
  select 'admin:' || user_id into v_owner
    from public.admins
   where lower(email) = 'dominic.maag@swiss-sv.ch'
   limit 1;

  v_besitz := case when v_owner is null then array[]::text[] else array[v_owner] end;

  -- Zeitachse wie im Excel, aber nur über den Bereich, in dem diese beiden
  -- Firmen arbeiten. Ein Plan, der bei KW37 anfängt und bis KW43 leer bleibt,
  -- zeigt auf dem Handy vor allem weisse Fläche.
  update public.projects
     set schedule_start = date '2026-10-19',
         schedule_end   = date '2026-11-27'
   where id = v_projekt;

  -- Nur dieses eine Projekt, und erst nach der Sperre oben.
  delete from public.schedule_tasks where project_id = v_projekt;

  insert into public.schedule_tasks
    (project_id, responsible, owner, owners, label, start_date, end_date, color, order_index)
  values
    -- ---------------------------------------------------------------- Melintec
    -- Blau wie im Excel.
    (v_projekt, 'Melintec AG', v_owner, v_besitz, 'Abschluss Elektro Diverses',
     date '2026-10-19', date '2026-10-23', '#00B0F0', 10),
    (v_projekt, 'Melintec AG', v_owner, v_besitz, 'AC-Installationen',
     date '2026-10-26', date '2026-10-30', '#00B0F0', 11),

    -- --------------------------------------------------------------- Convoltas
    -- Orange wie im Excel.
    (v_projekt, 'Convoltas AG', v_owner, v_besitz, 'PV UK Altbau + WR-Montage',
     date '2026-10-19', date '2026-10-23', '#FFC000', 20),
    (v_projekt, 'Convoltas AG', v_owner, v_besitz, 'UK Neubau',
     date '2026-10-26', date '2026-10-30', '#FFC000', 21),
    (v_projekt, 'Convoltas AG', v_owner, v_besitz, 'DC-Verkabelung',
     date '2026-11-02', date '2026-11-06', '#FFC000', 22),
    (v_projekt, 'Convoltas AG', v_owner, v_besitz, 'Modulmontage',
     date '2026-11-09', date '2026-11-13', '#FFC000', 23),
    (v_projekt, 'Convoltas AG', v_owner, v_besitz, 'Abschlussarbeiten',
     date '2026-11-16', date '2026-11-20', '#FFC000', 24),
    -- Die Inbetriebnahme steht im Excel als eigener, kurzer Balken und grün
    -- abgesetzt: Sie ist der Schlusspunkt und keine Bauarbeit.
    (v_projekt, 'Convoltas AG', v_owner, v_besitz, 'IBN – Inbetriebnahme',
     date '2026-11-23', date '2026-11-23', '#70AD47', 25);

  raise notice 'Terminplan PVA aufgebaut: 2 Arbeiten Melintec, 6 Convoltas.';
end;
$$;

-- Kontrolle: Stimmt der Plan – und steht er beim richtigen Projekt?
--   select p.name, t.responsible, t.label, t.start_date, t.end_date
--     from public.schedule_tasks t
--     join public.projects p on p.id = t.project_id
--    where p.name ilike '%tägerwilen%'
--    order by p.name, t.order_index;
