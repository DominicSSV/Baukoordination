-- =============================================================================
-- Baukoordination – Erweiterung 6: Terminplan
--
-- Balkenplan je Projekt: links Zuständiger und Arbeit, rechts ein Tagesraster.
-- Nachbau des bisherigen Excel-Terminplans.
--
-- Im Supabase SQL-Editor ausführen. Idempotent.
-- =============================================================================

-- Zeitraum des Plans. Bleibt er leer, spannt die App ihn über die erfassten
-- Arbeiten – so muss man ihn nicht zwingend von Hand setzen.
alter table public.projects
  add column if not exists schedule_start date;

alter table public.projects
  add column if not exists schedule_end date;

create table if not exists public.schedule_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  responsible text,                                   -- z.B. 'Gärtner', 'Kran'
  label       text not null,                          -- z.B. 'Grabarbeiten'
  start_date  date not null,
  end_date    date not null,
  color       text not null default '#00BF63',
  order_index integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint schedule_tasks_zeitraum check (end_date >= start_date)
);

create index if not exists schedule_tasks_project_idx
  on public.schedule_tasks (project_id, order_index, start_date);

alter table public.schedule_tasks enable row level security;

-- Sehen darf den Plan jeder mit Zugriff auf das Projekt – auch die Lieferanten,
-- für die er ja gedacht ist. Ändern darf ihn nur die Swiss Solar Ventures AG.
drop policy if exists schedule_tasks_select on public.schedule_tasks;
create policy schedule_tasks_select on public.schedule_tasks
  for select using (public.has_project_access(project_id));

drop policy if exists schedule_tasks_admin_write on public.schedule_tasks;
create policy schedule_tasks_admin_write on public.schedule_tasks
  for all using (public.is_admin()) with check (public.is_admin());
