-- =============================================================================
-- Baukoordination – Migration 21: Unterordner in den Dokumenten
--
-- Die Gliederung bekommt eine zweite Ebene, und die Standardordner werden neu
-- gefasst:
--
--   Photovoltaik
--     Bewilligung
--     AC
--     DC
--   Gebäudehülle
--   Abrechnungslösung
--
-- Zwei Ebenen und nicht beliebig viele: Tiefer verschachtelt findet auf der
-- Baustelle niemand mehr etwas, und die Ansicht bliebe auf dem Handy unlesbar.
--
-- Bestehende Projekte werden umgestellt, ohne dass abgelegte Dokumente
-- verloren gehen: "Photovoltaik AC" wird zu "AC" unter "Photovoltaik", "Beleuchtung"
-- verschwindet nur, wenn nichts darin liegt.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0019 voraus.
-- =============================================================================

-- 1) Zweite Ebene -------------------------------------------------------------
alter table public.document_folders
  add column if not exists parent_id uuid
    references public.document_folders (id) on delete restrict;

create index if not exists document_folders_eltern_idx
  on public.document_folders (parent_id);

-- Die Namenssperre gilt je Ebene: "AC" darf es unter "Photovoltaik" geben und
-- gleichzeitig als Hauptordner. Zwei Teilindizes, weil ein gewöhnlicher
-- Unique-Index zwei NULL-Werte als verschieden ansieht und oberste Ordner
-- damit doppelt entstehen könnten.
drop index if exists public.document_folders_name_idx;

create unique index if not exists document_folders_name_oben_idx
  on public.document_folders (project_id, lower(name))
  where parent_id is null;

create unique index if not exists document_folders_name_unten_idx
  on public.document_folders (project_id, parent_id, lower(name))
  where parent_id is not null;

-- 2) Nicht tiefer als zwei Ebenen ---------------------------------------------
create or replace function public.dokumentordner_tiefe_pruefen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grosseltern uuid;
  v_projekt     uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Ein Ordner kann nicht in sich selbst liegen.';
  end if;

  select parent_id, project_id into v_grosseltern, v_projekt
    from public.document_folders
   where id = new.parent_id;

  if v_projekt is null then
    raise exception 'Der übergeordnete Ordner gibt es nicht.';
  end if;

  if v_projekt <> new.project_id then
    raise exception 'Der übergeordnete Ordner gehört zu einem anderen Projekt.';
  end if;

  if v_grosseltern is not null then
    raise exception 'Mehr als zwei Ebenen sind nicht vorgesehen.';
  end if;

  return new;
end;
$$;

drop trigger if exists document_folders_tiefe on public.document_folders;
create trigger document_folders_tiefe
  before insert or update on public.document_folders
  for each row execute function public.dokumentordner_tiefe_pruefen();

-- 3) Löschen nur, wenn wirklich leer ------------------------------------------
-- Bisher zählte nur, ob Dokumente drin liegen. Ein Hauptordner mit Unterordnern
-- ist aber auch nicht leer.
create or replace function public.dokumentordner_nur_leer_loeschen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  anzahl integer;
begin
  select count(*) into anzahl
    from public.files
   where document_folder = old.id;

  if anzahl > 0 then
    raise exception
      'Der Ordner enthält noch % Dokument(e). Bitte zuerst wegräumen.', anzahl
      using errcode = 'restrict_violation';
  end if;

  select count(*) into anzahl
    from public.document_folders
   where parent_id = old.id;

  if anzahl > 0 then
    raise exception
      'Der Ordner enthält noch % Unterordner. Bitte zuerst wegräumen.', anzahl
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

-- 4) Neue Standardgliederung --------------------------------------------------
create or replace function public.standard_dokumentordner(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pv uuid;
begin
  insert into public.document_folders (project_id, name, position)
  values (p_project, 'Photovoltaik', 1)
  on conflict do nothing;

  select id into v_pv
    from public.document_folders
   where project_id = p_project and parent_id is null and lower(name) = 'photovoltaik'
   limit 1;

  if v_pv is not null then
    insert into public.document_folders (project_id, parent_id, name, position)
    select p_project, v_pv, name, position
      from (values ('Bewilligung', 1), ('AC', 2), ('DC', 3)) as v (name, position)
    on conflict do nothing;
  end if;

  insert into public.document_folders (project_id, name, position)
  select p_project, name, position
    from (values ('Gebäudehülle', 2), ('Abrechnungslösung', 3)) as v (name, position)
  on conflict do nothing;
end;
$$;

revoke all on function public.standard_dokumentordner(uuid)
  from public, anon, authenticated;
revoke all on function public.dokumentordner_tiefe_pruefen()
  from public, anon, authenticated;
grant execute on function public.standard_dokumentordner(uuid) to service_role;

-- 5) Bestehende Projekte umstellen --------------------------------------------
-- Abgelegte Dokumente bleiben, wo sie sind: Die alten Ordner "Photovoltaik AC"
-- und "Photovoltaik DC" werden verschoben und umbenannt, nicht ersetzt.
do $$
declare
  p  record;
  v_pv uuid;
begin
  for p in select id from public.projects loop
    -- Fehlende Ordner der neuen Gliederung ergänzen.
    perform public.standard_dokumentordner(p.id);

    select id into v_pv
      from public.document_folders
     where project_id = p.id and parent_id is null and lower(name) = 'photovoltaik'
     limit 1;

    if v_pv is not null then
      -- "Photovoltaik AC" -> "AC" unter "Photovoltaik", sofern es dort noch
      -- kein "AC" gibt (sonst bliebe der alte Ordner mit seinem Inhalt stehen
      -- und wir hätten den Namen zweimal).
      update public.document_folders alt
         set name = 'AC', parent_id = v_pv, position = 2
       where alt.project_id = p.id
         and alt.parent_id is null
         and lower(alt.name) = 'photovoltaik ac'
         and not exists (
           select 1 from public.document_folders neu
            where neu.project_id = p.id and neu.parent_id = v_pv
              and lower(neu.name) = 'ac'
              and neu.id <> alt.id
         );

      update public.document_folders alt
         set name = 'DC', parent_id = v_pv, position = 3
       where alt.project_id = p.id
         and alt.parent_id is null
         and lower(alt.name) = 'photovoltaik dc'
         and not exists (
           select 1 from public.document_folders neu
            where neu.project_id = p.id and neu.parent_id = v_pv
              and lower(neu.name) = 'dc'
              and neu.id <> alt.id
         );
    end if;

    -- "Beleuchtung" gehört nicht mehr zur Vorlage. Weg damit – aber nur, wenn
    -- niemand schon etwas hineingelegt hat.
    delete from public.document_folders f
     where f.project_id = p.id
       and f.parent_id is null
       and lower(f.name) = 'beleuchtung'
       and not exists (select 1 from public.files d where d.document_folder = f.id)
       and not exists (select 1 from public.document_folders u where u.parent_id = f.id);
  end loop;
end;
$$;

-- Kontrolle:
--   select p.name as projekt,
--          coalesce(e.name || ' / ', '') || f.name as ordner,
--          f.position
--     from public.document_folders f
--     join public.projects p on p.id = f.project_id
--     left join public.document_folders e on e.id = f.parent_id
--    order by p.name, coalesce(e.position, f.position), f.parent_id nulls first, f.position;
