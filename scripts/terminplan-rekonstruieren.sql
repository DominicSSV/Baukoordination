-- =============================================================================
-- Terminplan aus dem Protokoll rekonstruieren
--
-- KEINE MIGRATION. Diese Datei liegt bewusst nicht bei den Migrationen: Sie ist
-- ein Werkzeug fuer den Notfall und nichts, was man der Reihe nach ausfuehrt.
--
-- Sie LIEST NUR. Kein delete, kein update, kein insert.
--
-- Wofuer: Wurden Arbeiten aus einem Terminplan geloescht, gibt es dafuer keinen
-- Papierkorb - schedule_tasks kennt kein deleted_at, und die Rueckmeldungen
-- haengen mit "on delete cascade" daran. Was bleibt, steht im Protokoll: Jede
-- in der App angelegte oder geaenderte Arbeit hat dort einen Eintrag mit
-- Bezeichnung UND Zeitraum hinterlassen, zum Beispiel
--
--   hat "Batterien anliefern" im Terminplan aufgenommen (12.10.-16.10.2026)
--
-- Daraus laesst sich der Plan von Hand wieder aufbauen.
--
-- Entstanden ist die Datei, nachdem ein Datenskript den Terminplan des
-- falschen Projekts geloescht hatte. Der Anlass ist erledigt, das Werkzeug
-- bleibt - beim naechsten Mal muss es niemand neu schreiben.
--
-- Im Supabase SQL-Editor ausfuehren. Den Projektnamen unten anpassen.
-- =============================================================================


-- 1) Welche Projekte gibt es in Tägerwilen, und was steht gerade in ihren
--    Terminplänen? Damit ist klar, wo der PVA-Plan gelandet ist.
select p.name             as projekt,
       p.ort,
       p.schedule_start,
       p.schedule_end,
       count(t.id)        as arbeiten,
       string_agg(t.label, ' | ' order by t.order_index) as inhalt
  from public.projects p
  left join public.schedule_tasks t on t.project_id = p.id
 where p.name ilike '%tägerwilen%' or p.name ilike '%taegerwilen%'   -- <- Projektname
    or p.ort  ilike '%tägerwilen%' or p.ort  ilike '%taegerwilen%'
 group by p.id, p.name, p.ort, p.schedule_start, p.schedule_end
 order by p.name;


-- 2) Was weiss das Protokoll noch über den Terminplan von BESS?
--
-- Jede Arbeit, die in der App angelegt oder geändert wurde, hat einen Eintrag
-- hinterlassen – mit Bezeichnung UND Zeitraum, zum Beispiel:
--   hat "Batterien anliefern" im Terminplan aufgenommen (12.10.–16.10.2026)
--
-- Daraus lässt sich der Plan von Hand wieder aufbauen. Kommt hier nichts,
-- wurde der Plan entweder per Skript angelegt (dann steht er nirgends im
-- Protokoll) oder die Einträge fielen der Protokoll-Leerung zum Opfer.
select a.created_at,
       a.actor_name,
       a.text
  from public.activity a
  join public.projects p on p.id = a.project_id
 where (p.name ilike '%bess%')   -- <- hier den Projektnamen eintragen
   and (a.text like '%Terminplan%')
 order by a.created_at;


-- 3) Dasselbe ohne Projektfilter – falls der Eintrag an einem anderen Projekt
--    hängt, weil BESS zwischenzeitlich umbenannt wurde.
select a.created_at, p.name as projekt, a.actor_name, a.text
  from public.activity a
  join public.projects p on p.id = a.project_id
 where a.text like '%Terminplan%'
 order by a.created_at desc
 limit 200;


-- 4) Die Rückmeldungen und Terminvorschläge zu den gelöschten Arbeiten sind
--    mitgegangen: schedule_notes hängt mit "on delete cascade" an der Arbeit.
--    Diese Abfrage bestätigt das nur – sie gibt nichts zurück. Was von den
--    Absprachen bleibt, steht im Protokoll (Abfrage 2 und 3).
select count(*) as verwaiste_rueckmeldungen
  from public.schedule_notes n
  left join public.schedule_tasks t on t.id = n.task_id
 where t.id is null;
