-- =============================================================================
-- Baukoordination – Migration 14: mehrere Zuständige, To-Dos nur für Beteiligte
--
-- Zwei Änderungen:
--   1. Eine Aufgabe kann mehreren Personen gehören (Spalte assignees).
--   2. Ein Lieferant sieht nur noch Aufgaben, die ihn oder seine Firma betreffen
--      – zugewiesen oder selbst erstellt. Wir sehen weiterhin alles.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt die Migrationen 0012 und 0013 voraus.
-- =============================================================================

-- 1) Firmenzugehörigkeit als eigene Funktion --------------------------------
-- Bisher steckte diese Regel in darf_offerte_sehen(); sie gilt jetzt auch für
-- Aufgaben, deshalb bekommt sie einen eigenen, neutralen Namen.
create or replace function public.ist_meine_firma(p_supplier uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_supplier is null then false
    when public.current_supplier_id() is null then false
    when p_supplier = public.current_supplier_id() then true
    else coalesce(
      public.supplier_firma(p_supplier) is not null
      and public.supplier_firma(p_supplier)
          = public.supplier_firma(public.current_supplier_id()),
      false
    )
  end;
$$;

create or replace function public.darf_offerte_sehen(p_uploader uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ist_meine_firma(p_uploader);
$$;

grant execute on function public.ist_meine_firma(uuid) to anon, authenticated;

-- 2) Mehrere Zuständige ------------------------------------------------------
-- assigned_to bleibt als erster Eintrag bestehen: Altbestand, Mahnungen und
-- Protokolltexte greifen darauf zu.
alter table public.todos
  add column if not exists assignees text[];

update public.todos
   set assignees = array[assigned_to]
 where assignees is null or cardinality(assignees) = 0;

alter table public.todos
  alter column assignees set default array['internal'];

create index if not exists todos_assignees_idx on public.todos using gin (assignees);

-- 3) Betrifft diese Aufgabe den angemeldeten Lieferanten? --------------------
create or replace function public.todo_betrifft_mich(
  p_assignees text[],
  p_assigned_to text,
  p_ersteller uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_supplier_id() is null then false
    -- Selbst (oder die eigene Firma) erstellt: immer sichtbar, sonst könnte man
    -- die eigene Anfrage an uns nicht mehr verfolgen.
    when public.ist_meine_firma(p_ersteller) then true
    else exists (
      select 1
        from unnest(coalesce(nullif(p_assignees, '{}'), array[p_assigned_to])) as a
       -- Muster streng prüfen: ein unsauberer Altwert würde sonst beim
       -- Umwandeln in eine uuid die ganze Abfrage abbrechen lassen.
       where a ~ '^supplier:[0-9a-fA-F-]{36}$'
         and public.ist_meine_firma(substring(a from 10)::uuid)
    )
  end;
$$;

grant execute on function public.todo_betrifft_mich(text[], text, uuid) to anon, authenticated;

-- 4) Sichtbarkeit der Aufgaben ----------------------------------------------
drop policy if exists todos_select on public.todos;
create policy todos_select on public.todos
  for select using (
    public.has_project_access(project_id)
    and (
      public.is_admin()
      or public.todo_betrifft_mich(assignees, assigned_to, created_by_supplier_id)
    )
  );

-- Kommentare und Anhänge folgen der Aufgabe: was man nicht sieht, darf man auch
-- nicht über den Umweg der Kommentare oder der Dateiliste sehen.
drop policy if exists todo_comments_select on public.todo_comments;
create policy todo_comments_select on public.todo_comments
  for select using (
    exists (select 1 from public.todos t where t.id = todo_id)
  );

drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    public.has_project_access(project_id)
    and (
      offer_folder is null
      or public.is_admin()
      or public.ist_meine_firma(uploaded_by_supplier_id)
    )
    and (
      todo_id is null
      or public.is_admin()
      or exists (select 1 from public.todos t where t.id = todo_id)
    )
  );

-- 5) Schutz beim Ändern ------------------------------------------------------
-- Wie bisher: an fremden Aufgaben darf ein Lieferant nur den Haken setzen.
-- Neu ist die Spalte assignees in der Aufzählung.
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
--   select text, assigned_to, assignees from public.todos order by created_at desc limit 10;
