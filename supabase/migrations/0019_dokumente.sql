-- =============================================================================
-- Baukoordination – Migration 19: Register "Dokumente" mit eigenen Ordnern
--
-- Pläne, Schemas und Datenblätter je Gewerk. Anders als bei den Offerten sind
-- das Unterlagen, die alle Beteiligten brauchen – der Elektriker muss das
-- DC-Schema sehen können. Sichtbar ist deshalb alles für jeden, der Zugriff auf
-- das Projekt hat. Die Ordnerstruktur verwaltet nur die Swiss Solar Ventures AG,
-- sonst räumt jede Firma das Projekt nach ihrem Gutdünken um.
--
-- Jedes neue Projekt bekommt die fünf üblichen Ordner automatisch.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

-- 1) Ordner -------------------------------------------------------------------
create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Zwei Ordner gleichen Namens im selben Projekt wären nicht zu unterscheiden.
-- Gross-/Kleinschreibung soll dabei nicht ausschlaggebend sein.
create unique index if not exists document_folders_name_idx
  on public.document_folders (project_id, lower(name));

create index if not exists document_folders_projekt_idx
  on public.document_folders (project_id, position);

-- 2) Zuordnung der Dateien ----------------------------------------------------
alter table public.files
  add column if not exists document_folder uuid
    references public.document_folders (id) on delete restrict;

create index if not exists files_dokumentordner_idx
  on public.files (document_folder);

-- 3) Die üblichen Ordner für jedes neue Projekt -------------------------------
create or replace function public.standard_dokumentordner(p_project uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.document_folders (project_id, name, position)
  select p_project, name, position
    from (values
      ('Gebäudehülle', 1),
      ('Photovoltaik AC', 2),
      ('Photovoltaik DC', 3),
      ('Beleuchtung', 4),
      ('Abrechnungslösung', 5)
    ) as vorlage (name, position)
  on conflict do nothing;
$$;

create or replace function public.projekt_dokumentordner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.standard_dokumentordner(new.id);
  return new;
end;
$$;

-- Als Trigger und nicht in der Anwendung: So bekommt auch ein dupliziertes oder
-- von Hand angelegtes Projekt seine Ordner, ohne dass jemand daran denken muss.
drop trigger if exists projects_dokumentordner on public.projects;
create trigger projects_dokumentordner
  after insert on public.projects
  for each row execute function public.projekt_dokumentordner();

-- Bestehende Projekte nachziehen – nur solche, die noch gar keine Ordner haben.
do $$
declare
  p record;
begin
  for p in
    select pr.id from public.projects pr
     where not exists (
       select 1 from public.document_folders f where f.project_id = pr.id
     )
  loop
    perform public.standard_dokumentordner(p.id);
  end loop;
end;
$$;

-- 4) Ordner nur leeren löschen ------------------------------------------------
-- Die Anwendung prüft das ebenfalls; hier steht die Sperre, die auch dann hält,
-- wenn jemand direkt auf der Datenbank arbeitet. Der Fremdschlüssel oben würde
-- zwar auch greifen, aber mit einer Meldung, die niemandem weiterhilft.
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

  return old;
end;
$$;

drop trigger if exists document_folders_leer on public.document_folders;
create trigger document_folders_leer
  before delete on public.document_folders
  for each row execute function public.dokumentordner_nur_leer_loeschen();

-- 5) Rechte -------------------------------------------------------------------
alter table public.document_folders enable row level security;

-- Sehen darf jeder, der das Projekt sieht: Die Ordner sind die Gliederung der
-- gemeinsamen Unterlagen, nicht die Ablage einer einzelnen Firma.
drop policy if exists document_folders_select on public.document_folders;
create policy document_folders_select on public.document_folders
  for select using (public.has_project_access(project_id));

-- Anlegen, umbenennen und löschen bleibt bei uns.
drop policy if exists document_folders_insert on public.document_folders;
create policy document_folders_insert on public.document_folders
  for insert with check (public.is_admin() and public.has_project_access(project_id));

drop policy if exists document_folders_update on public.document_folders;
create policy document_folders_update on public.document_folders
  for update using (public.is_admin() and public.has_project_access(project_id))
  with check (public.is_admin() and public.has_project_access(project_id));

drop policy if exists document_folders_delete on public.document_folders;
create policy document_folders_delete on public.document_folders
  for delete using (public.is_admin() and public.has_project_access(project_id));

-- Die drei Funktionen oben laufen mit den Rechten ihres Besitzers und gehen
-- damit an den Policies vorbei. Von aussen aufrufbar dürfen sie deshalb nicht
-- sein: Sonst könnte ein angemeldeter Lieferant standard_dokumentordner() mit
-- einer fremden Projektkennung aufrufen und dort Ordner anlegen. Auslöser
-- bleiben von der Sperre unberührt – Postgres prüft das Ausführungsrecht beim
-- Anlegen des Triggers, nicht bei jedem Auslösen.
revoke all on function public.standard_dokumentordner(uuid)
  from public, anon, authenticated;
revoke all on function public.projekt_dokumentordner()
  from public, anon, authenticated;
revoke all on function public.dokumentordner_nur_leer_loeschen()
  from public, anon, authenticated;

grant execute on function public.standard_dokumentordner(uuid) to service_role;

comment on table public.document_folders is
  'Gliederung des Registers "Dokumente" je Projekt. Sichtbar für alle im Projekt.';
