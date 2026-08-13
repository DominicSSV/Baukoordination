-- =============================================================================
-- Baukoordination – Erweiterung 10: Rückmeldungen zum Terminplan
--
-- Lieferanten können zu einer Arbeit im Terminplan etwas anmerken und einen
-- anderen Zeitraum vorschlagen. Der Vorschlag ändert den Plan nicht – die
-- Swiss Solar Ventures AG übernimmt ihn per Klick oder lehnt ihn ab.
--
-- Im Supabase SQL-Editor ausführen. Idempotent.
-- =============================================================================

create table if not exists public.schedule_notes (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.schedule_tasks(id) on delete cascade,
  text        text not null,
  author      text not null,
  author_supplier_id uuid references public.suppliers(id) on delete set null,
  -- Gesetzt, wenn es ein Verschiebe-Vorschlag ist. Sonst reine Anmerkung.
  vorschlag_start date,
  vorschlag_ende  date,
  -- 'offen' | 'uebernommen' | 'abgelehnt'
  status      text not null default 'offen',
  created_at  timestamptz not null default now(),
  constraint schedule_notes_status_gueltig
    check (status in ('offen', 'uebernommen', 'abgelehnt')),
  constraint schedule_notes_zeitraum
    check (vorschlag_ende is null or vorschlag_start is null
           or vorschlag_ende >= vorschlag_start)
);

create index if not exists schedule_notes_task_idx
  on public.schedule_notes (task_id, created_at);

alter table public.schedule_notes enable row level security;

-- Lesen darf jeder mit Zugriff auf das Projekt der Arbeit.
drop policy if exists schedule_notes_select on public.schedule_notes;
create policy schedule_notes_select on public.schedule_notes
  for select using (
    exists (
      select 1 from public.schedule_tasks t
      where t.id = task_id and public.has_project_access(t.project_id)
    )
  );

-- Schreiben darf jeder mit Projektzugriff – der Lieferant nur in eigenem Namen.
drop policy if exists schedule_notes_insert on public.schedule_notes;
create policy schedule_notes_insert on public.schedule_notes
  for insert with check (
    exists (
      select 1 from public.schedule_tasks t
      where t.id = task_id and public.has_project_access(t.project_id)
    )
    and (
      public.is_admin()
      or author_supplier_id = public.current_supplier_id()
    )
  );

-- Über Vorschläge entscheidet allein die Swiss Solar Ventures AG.
drop policy if exists schedule_notes_update on public.schedule_notes;
create policy schedule_notes_update on public.schedule_notes
  for update using (public.is_admin()) with check (public.is_admin());

-- Eigene Anmerkungen darf man zurücknehmen, fremde nur der Admin.
drop policy if exists schedule_notes_delete on public.schedule_notes;
create policy schedule_notes_delete on public.schedule_notes
  for delete using (
    public.is_admin()
    or (author_supplier_id is not null
        and author_supplier_id = public.current_supplier_id())
  );
