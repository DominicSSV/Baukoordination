-- =============================================================================
-- Baukoordination – Migration 17: Papierkorb und Offerten mit Beträgen
--
-- 1. Gelöschte Aufgaben und Dateien wandern in einen Papierkorb und lassen sich
--    30 Tage lang zurückholen. Endgültig entfernt wird erst danach – oder von
--    Hand durch die Swiss Solar Ventures AG.
-- 2. Zu jeder eingereichten Unterlage lassen sich Betrag und Stand erfassen,
--    damit sich Angebote vergleichen lassen.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt die Migrationen 0012 bis 0016 voraus.
-- =============================================================================

-- 1) Papierkorb ---------------------------------------------------------------
alter table public.todos
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

alter table public.files
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

create index if not exists todos_papierkorb_idx
  on public.todos (project_id, deleted_at);
create index if not exists files_papierkorb_idx
  on public.files (project_id, deleted_at);

-- 2) Offerten mit Betrag und Stand --------------------------------------------
alter table public.files
  add column if not exists offer_amount numeric(12, 2),
  add column if not exists offer_status text;

alter table public.files drop constraint if exists files_offer_status_check;
alter table public.files
  add constraint files_offer_status_check
  check (
    offer_status is null
    or offer_status in ('eingereicht', 'geprueft', 'vergeben', 'abgelehnt')
  );

-- 3) Ändern von Dateien -------------------------------------------------------
-- Bisher gab es keine Update-Regel, also war jede Änderung gesperrt. Ändern darf
-- jetzt, wer die Datei auch löschen dürfte: wir alles, ein Lieferant das Eigene.
drop policy if exists files_update on public.files;
create policy files_update on public.files
  for update using (
    public.has_project_access(project_id)
    and (
      public.is_admin()
      or (uploaded_by_supplier_id is not null
          and uploaded_by_supplier_id = public.current_supplier_id())
    )
  )
  with check (
    public.has_project_access(project_id)
    and (
      public.is_admin()
      or (uploaded_by_supplier_id is not null
          and uploaded_by_supplier_id = public.current_supplier_id())
    )
  );

-- Was ein Lieferant an der eigenen Datei ändern darf, ist eng gefasst: Name,
-- Betrag und das Wegwerfen. Über den Stand einer Offerte entscheiden wir, und
-- der Ablageort darf sich nicht nachträglich verschieben.
create or replace function public.files_supplier_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_supplier_id() is null then
    return new;
  end if;

  if new.offer_status  is distinct from old.offer_status
     or new.offer_folder is distinct from old.offer_folder
     or new.project_id   is distinct from old.project_id
     or new.todo_id      is distinct from old.todo_id
     or new.storage_path is distinct from old.storage_path
     or new.uploaded_by_supplier_id is distinct from old.uploaded_by_supplier_id
  then
    raise exception 'Diese Angabe darf nur die Swiss Solar Ventures AG ändern.';
  end if;

  return new;
end;
$$;

drop trigger if exists files_supplier_update_guard on public.files;
create trigger files_supplier_update_guard
  before update on public.files
  for each row execute function public.files_supplier_update_guard();

-- 4) Wegwerfen statt löschen --------------------------------------------------
-- Aus dem Löschen wird eine Änderung. Der bestehende Schutz an den Aufgaben muss
-- deshalb auch das Papierkorb-Feld kennen: an fremden Aufgaben bleibt es tabu.
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
     or new.deleted_at   is distinct from old.deleted_at
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
--   select text, deleted_at from public.todos where deleted_at is not null;
--   select name, offer_folder, offer_amount, offer_status from public.files
--    where offer_folder is not null;
