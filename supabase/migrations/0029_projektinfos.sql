-- =============================================================================
-- Baukoordination – Migration 29: Projektinformationen
--
-- Zwei Tabellen für dasselbe Register "Infos": die Angaben zum Objekt (Zugang,
-- Standort, Parkieren, Besonderheiten) und die Leute am Bau, die nicht in der
-- App sind.
--
-- Auf jeder Baustelle gibt es Leute, die nicht in der App sind und auch nicht
-- hineingehören: der Hauswart, die Verwaltung, der Bauherr, die Ansprechperson
-- vor Ort. Ihre Nummern standen bisher in Mails, im Telefon oder im Kopf – und
-- wer sie nicht hatte, stand vor verschlossener Tür.
--
-- Neu hängen sie am Projekt. Sehen darf sie jeder mit Zugriff auf das Projekt,
-- auch die Lieferanten: Genau dafür sind sie da. Ändern darf sie nur die
-- Swiss Solar Ventures AG – dieselbe Regel wie beim Terminplan.
--
-- Bewusst eine eigene Tabelle und nicht die Lieferantenliste: Diese Personen
-- haben keinen Zugang, keinen Code und kein Projekt-Recht. Sie in suppliers zu
-- führen hiesse, jedem Hauswart versehentlich eine Anmeldung zu geben.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

create table if not exists public.project_contacts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- Wofür die Person zuständig ist: Hauswart, Kontakt vor Ort, Elektriker …
  rolle       text not null,
  name        text,
  firma       text,
  telefon     text,
  email       text,
  -- Platz für das, was sonst nirgends hinpasst: "Schlüssel bei ihm",
  -- "erreichbar ab 7 Uhr", "spricht nur Französisch".
  notiz       text,
  -- Reihenfolge in der Liste. Der wichtigste Kontakt gehört nach oben.
  sortierung  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text
);

create index if not exists project_contacts_projekt_idx
  on public.project_contacts (project_id, sortierung, created_at);

alter table public.project_contacts enable row level security;

-- Sehen darf sie jeder mit Zugriff auf das Projekt – auch die Lieferanten, für
-- die sie ja gedacht sind. Ändern darf sie nur die Swiss Solar Ventures AG.
drop policy if exists project_contacts_select on public.project_contacts;
create policy project_contacts_select on public.project_contacts
  for select using (public.has_project_access(project_id));

drop policy if exists project_contacts_admin_write on public.project_contacts;
create policy project_contacts_admin_write on public.project_contacts
  for all using (public.is_admin()) with check (public.is_admin());

comment on table public.project_contacts is
  'Personen am Bau ohne App-Zugang: Hauswart, Verwaltung, Bauherr, '
  'Ansprechperson vor Ort. Reine Adressliste, kein Zugriffsrecht.';

-- Kontrolle:
--   select p.name as projekt, k.rolle, k.name, k.telefon
--     from public.project_contacts k
--     join public.projects p on p.id = k.project_id
--    order by p.name, k.sortierung;

-- ---------------------------------------------------------------------------
-- Angaben zum Objekt: Zugang, Standort, Parkieren, Besonderheiten.
--
-- Bewusst freie Zeilen aus Titel und Text statt fester Spalten. Auf der
-- nächsten Baustelle ist es die Alarmanlage, danach der Kranstellplatz – für
-- jede neue Angabe eine Spalte anzulegen hiesse, für jede Kleinigkeit die
-- Datenbank zu ändern. Vorschläge für die üblichen Titel macht die App.
-- ---------------------------------------------------------------------------

create table if not exists public.project_infos (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  titel       text not null,
  text        text,
  sortierung  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text
);

create index if not exists project_infos_projekt_idx
  on public.project_infos (project_id, sortierung, created_at);

alter table public.project_infos enable row level security;

-- Gleiche Regel wie bei den Kontakten: Alle Beteiligten sehen die Angaben –
-- ohne den Zugangscode zur Tiefgarage steht der Elektriker vor dem Tor.
-- Pflegen darf sie nur die Swiss Solar Ventures AG.
drop policy if exists project_infos_select on public.project_infos;
create policy project_infos_select on public.project_infos
  for select using (public.has_project_access(project_id));

drop policy if exists project_infos_admin_write on public.project_infos;
create policy project_infos_admin_write on public.project_infos
  for all using (public.is_admin()) with check (public.is_admin());

comment on table public.project_infos is
  'Angaben zum Objekt: Zugang, Standort, Parkieren, Besonderheiten. '
  'Freie Zeilen aus Titel und Text, damit neue Angaben keine Migration brauchen.';

-- Kontrolle:
--   select p.name as projekt, i.titel, i.text
--     from public.project_infos i
--     join public.projects p on p.id = i.project_id
--    order by p.name, i.sortierung;
