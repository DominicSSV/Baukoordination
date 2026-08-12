-- =============================================================================
-- Baukoordination – Erweiterung 4: Fristen für Aufgaben
--
-- Jede Aufgabe kann ein "zu erledigen bis" bekommen. Ist die Frist überschritten
-- und die Aufgabe noch offen, geht eine dringende Mail an den Zuständigen.
--
-- Im Supabase SQL-Editor ausführen. Idempotent.
-- =============================================================================

alter table public.todos
  add column if not exists due_date date;

-- Verhindert, dass der tägliche Prüflauf dieselbe Frist mehrfach anmahnt.
-- Wird beim Ändern der Frist zurückgesetzt, damit eine neue Frist neu mahnt.
alter table public.todos
  add column if not exists overdue_notified_at timestamptz;

create index if not exists todos_due_offen_idx
  on public.todos (due_date)
  where done = false;

-- -----------------------------------------------------------------------------
-- Schreib-Wächter erweitern
--
-- Ein Lieferant darf eine fremde Aufgabe weiterhin nur abhaken. Ohne diese
-- Ergänzung könnte er sich an einer fremden Aufgabe die Frist selbst verschieben.
-- -----------------------------------------------------------------------------

create or replace function public.todos_supplier_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supplier uuid := public.current_supplier_id();
begin
  -- Admins und serverseitige Aufrufe mit service_role laufen ungehindert durch.
  if v_supplier is null then
    return new;
  end if;

  -- Eigenes To-Do: darf inhaltlich bearbeitet werden.
  if old.created_by_supplier_id is not null
     and old.created_by_supplier_id = v_supplier then
    if new.project_id is distinct from old.project_id then
      raise exception 'Ein To-Do kann nicht in ein anderes Projekt verschoben werden.';
    end if;
    return new;
  end if;

  -- Fremdes To-Do: ausschliesslich der Erledigt-Status darf sich ändern.
  if new.text            is distinct from old.text
     or new.assigned_to  is distinct from old.assigned_to
     or new.project_id   is distinct from old.project_id
     or new.order_index  is distinct from old.order_index
     or new.created_by   is distinct from old.created_by
     or new.due_date     is distinct from old.due_date
     or new.created_by_supplier_id is distinct from old.created_by_supplier_id
     or new.created_at   is distinct from old.created_at then
    raise exception 'Lieferanten dürfen fremde To-Dos nur abhaken, nicht bearbeiten.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists todos_supplier_update_guard on public.todos;
create trigger todos_supplier_update_guard
  before update on public.todos
  for each row execute function public.todos_supplier_update_guard();
