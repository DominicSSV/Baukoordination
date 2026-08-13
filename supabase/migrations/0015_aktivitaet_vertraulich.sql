-- =============================================================================
-- Baukoordination – Migration 15: vertrauliche Aufgaben
--
-- Eine Aufgabe ist standardmässig für alle am Projekt sichtbar. Wird sie beim
-- Anlegen als vertraulich gekennzeichnet, sehen sie nur wir und die beteiligten
-- Lieferantenfirmen – zugewiesen oder selbst erstellt.
--
-- Das Protokoll folgt derselben Regel: zu einer vertraulichen Aufgabe steht
-- nichts im Register "Aktivität", was andere Firmen lesen könnten. Dafür kann
-- ein Eintrag auf Firmen beschränkt werden:
--
--   supplier_ids ist null  → für alle mit Projektzugriff sichtbar
--   supplier_ids ist '{}'  → nur für die Swiss Solar Ventures AG
--   supplier_ids gefüllt   → für uns und die Firmen dieser Lieferanten
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt die Migrationen 0012 bis 0014 voraus.
-- =============================================================================

-- 1) Vertrauliche Aufgaben ----------------------------------------------------
alter table public.todos
  add column if not exists vertraulich boolean not null default false;

-- Sichtbar ist eine Aufgabe für alle am Projekt – ausser sie ist vertraulich,
-- dann nur für uns und die beteiligten Firmen.
drop policy if exists todos_select on public.todos;
create policy todos_select on public.todos
  for select using (
    public.has_project_access(project_id)
    and (
      public.is_admin()
      or not coalesce(vertraulich, false)
      or public.todo_betrifft_mich(assignees, assigned_to, created_by_supplier_id)
    )
  );

-- 2) Eingeschränkte Protokolleinträge ----------------------------------------
alter table public.activity
  add column if not exists supplier_ids uuid[];

-- Die Einzelspalte aus 0012 wandert in die Liste.
update public.activity
   set supplier_ids = array[supplier_id]
 where supplier_id is not null
   and supplier_ids is null;

create or replace function public.aktivitaet_sichtbar(p_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_ids is null then true
    when public.current_supplier_id() is null then false
    else exists (select 1 from unnest(p_ids) as x where public.ist_meine_firma(x))
  end;
$$;

grant execute on function public.aktivitaet_sichtbar(uuid[]) to anon, authenticated;

drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity
  for select using (
    public.has_project_access(project_id)
    and (
      public.is_admin()
      or public.aktivitaet_sichtbar(
           coalesce(
             supplier_ids,
             case when supplier_id is null then null else array[supplier_id] end
           )
         )
    )
  );

-- 3) Schutz beim Ändern ------------------------------------------------------
-- Auch das Kennzeichen "vertraulich" darf ein Lieferant an fremden Aufgaben
-- nicht verstellen.
create or replace function public.todos_supplier_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supplier uuid := public.current_supplier_id();
begin
  if v_supplier is null then
    return new;
  end if;

  if old.created_by_supplier_id is not null
     and old.created_by_supplier_id = v_supplier then
    if new.project_id is distinct from old.project_id then
      raise exception 'Ein To-Do kann nicht in ein anderes Projekt verschoben werden.';
    end if;
    return new;
  end if;

  if new.text            is distinct from old.text
     or new.assigned_to  is distinct from old.assigned_to
     or new.assignees    is distinct from old.assignees
     or new.vertraulich  is distinct from old.vertraulich
     or new.project_id   is distinct from old.project_id
     or new.order_index  is distinct from old.order_index
     or new.created_by   is distinct from old.created_by
     or new.due_date     is distinct from old.due_date
     or new.created_by_supplier_id is distinct from old.created_by_supplier_id
  then
    raise exception 'An fremden To-Dos darf nur der Erledigt-Status geändert werden.';
  end if;

  return new;
end;
$$;

drop trigger if exists todos_supplier_update_guard on public.todos;
create trigger todos_supplier_update_guard
  before update on public.todos
  for each row execute function public.todos_supplier_update_guard();

-- Kontrolle:
--   select text, vertraulich, assignees from public.todos order by created_at desc limit 10;
--   select text, supplier_ids from public.activity order by created_at desc limit 20;
