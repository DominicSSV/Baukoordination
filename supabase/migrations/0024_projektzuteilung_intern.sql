-- =============================================================================
-- Baukoordination – Migration 24: Wer von uns wird für welches Projekt benachrichtigt
--
-- Bisher bekam jede Person der Swiss Solar Ventures AG Post zu jedem Projekt.
-- Bei fünf Baustellen geht das; bei zwanzig liest es niemand mehr.
--
-- Neu lässt sich jede und jeder von uns einzelnen Projekten zuteilen. Das
-- betrifft ausschliesslich die Benachrichtigungen – gesehen wird weiterhin
-- überall alles. Die Zuteilung ist also keine Berechtigung, sondern ein Filter
-- für die Post; an den RLS-Regeln ändert sich bewusst nichts.
--
-- Ist für ein Projekt niemand zugeteilt, gehen die Nachrichten wie bisher an
-- alle. Sonst würde ein neues Projekt still verstummen.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

create table if not exists public.project_admins (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.admins (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_admins_person_idx
  on public.project_admins (user_id);

alter table public.project_admins enable row level security;

-- Nur wir – Lieferanten geht die interne Aufgabenteilung nichts an.
drop policy if exists project_admins_select on public.project_admins;
create policy project_admins_select on public.project_admins
  for select using (public.is_admin());

drop policy if exists project_admins_insert on public.project_admins;
create policy project_admins_insert on public.project_admins
  for insert with check (public.is_admin());

drop policy if exists project_admins_delete on public.project_admins;
create policy project_admins_delete on public.project_admins
  for delete using (public.is_admin());

comment on table public.project_admins is
  'Wer von der Swiss Solar Ventures AG für welches Projekt Post bekommt. '
  'Kein Zugriffsrecht – gesehen wird überall alles.';

-- Kontrolle:
--   select p.name, a.name
--     from public.project_admins pa
--     join public.projects p on p.id = pa.project_id
--     join public.admins a on a.user_id = pa.user_id
--    order by p.name, a.name;
