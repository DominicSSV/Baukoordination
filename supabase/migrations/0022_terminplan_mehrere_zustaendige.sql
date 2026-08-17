-- =============================================================================
-- Baukoordination – Migration 22: mehrere Zuständige im Terminplan
--
-- Bisher gehörte eine Zeile genau einer Person. Auf der Baustelle sind an einem
-- Gewerk aber oft zwei dran – der Elektriker und wir, oder zwei Firmen
-- gemeinsam. Neu trägt eine Arbeit eine Liste von Zuständigen.
--
-- owner bleibt als erster Eintrag bestehen: Die App fällt darauf zurück,
-- solange diese Migration nicht eingespielt ist, und ältere Auswertungen lesen
-- weiter dieselbe Spalte.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0008 voraus.
-- =============================================================================

alter table public.schedule_tasks
  add column if not exists owners text[];

-- Bestand übernehmen: aus einem Zuständigen wird eine Liste mit einem Eintrag.
-- Wo niemand eingetragen war, bleibt die Liste leer statt [null] – sonst stünde
-- dort später ein Zuständiger ohne Namen.
update public.schedule_tasks
   set owners = case
         when owner is null or btrim(owner) = '' then array[]::text[]
         else array[owner]
       end
 where owners is null;

alter table public.schedule_tasks
  alter column owners set default array[]::text[];

-- Zeilen werden nach ihren Zuständigen gruppiert – dafür wird die Spalte bei
-- jedem Aufbau des Plans gelesen.
create index if not exists schedule_tasks_zustaendige_idx
  on public.schedule_tasks using gin (owners);

-- Erster Eintrag und owner sollen nicht auseinanderlaufen: Wer nur owners
-- setzt (die App tut das), bekommt owner automatisch nachgeführt. So bleibt
-- der Rückfall auf die alte Spalte verlässlich.
create or replace function public.terminplan_zustaendige_gleichziehen()
returns trigger
language plpgsql
as $$
begin
  if new.owners is null then
    new.owners := case
      when new.owner is null or btrim(new.owner) = '' then array[]::text[]
      else array[new.owner]
    end;
  end if;

  new.owner := case
    when cardinality(new.owners) > 0 then new.owners[1]
    else null
  end;

  return new;
end;
$$;

drop trigger if exists schedule_tasks_zustaendige on public.schedule_tasks;
create trigger schedule_tasks_zustaendige
  before insert or update on public.schedule_tasks
  for each row execute function public.terminplan_zustaendige_gleichziehen();

revoke all on function public.terminplan_zustaendige_gleichziehen()
  from public, anon, authenticated;

comment on column public.schedule_tasks.owners is
  'Zuständige einer Arbeit, z.B. {admin:<uuid>,supplier:<uuid>}. owner ist der erste Eintrag.';

-- Kontrolle:
--   select label, owner, owners from public.schedule_tasks order by order_index;
