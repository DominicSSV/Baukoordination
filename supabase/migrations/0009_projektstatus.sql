-- =============================================================================
-- Baukoordination – Erweiterung 9: Projektstatus und eigene Reihenfolge
--
-- Projekte lassen sich in der Seitenleiste in vier Gruppen einteilen und
-- innerhalb der Gruppe frei sortieren.
--
-- Im Supabase SQL-Editor ausführen. Idempotent.
-- =============================================================================

-- 'planung' | 'umsetzung' | 'abschluss' | 'abgeschlossen'
alter table public.projects
  add column if not exists status text not null default 'umsetzung';

alter table public.projects
  add column if not exists order_index integer not null default 0;

-- Nur die vier vorgesehenen Werte zulassen.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_status_gueltig'
  ) then
    alter table public.projects
      add constraint projects_status_gueltig
      check (status in ('planung', 'umsetzung', 'abschluss', 'abgeschlossen'));
  end if;
end $$;

-- Bestehende Projekte einmal durchnummerieren, damit das Sortieren einen
-- definierten Ausgangspunkt hat.
with nummeriert as (
  select id, row_number() over (order by created_at) as nr
  from public.projects
)
update public.projects p
set order_index = n.nr
from nummeriert n
where p.id = n.id and p.order_index = 0;

create index if not exists projects_sortierung_idx
  on public.projects (status, order_index);
