-- =============================================================================
-- Baukoordination – Migration 30: Meilensteine und Vorlagen dafür
--
-- Eure Anlagen laufen alle nach demselben Muster ab: Bewilligung, Material,
-- Gerüst, DC, AC, Zähler, Inbetriebnahme, Abnahme. Bisher tippte man diese
-- Schritte bei jedem neuen Projekt von Hand ab – und vergass beim vierten
-- Projekt einen.
--
-- Ein Meilenstein ist bewusst keine neue Datensorte, sondern eine Aufgabe mit
-- einem Kennzeichen. Damit funktioniert alles weiter, was es für Aufgaben
-- schon gibt: abhaken, kommentieren, Frist setzen, zuweisen, im Protokoll
-- erscheinen, in "Meine To-Do's" auftauchen. Eine eigene Tabelle hätte all das
-- ein zweites Mal gebraucht.
--
-- Dazu kommen Vorlagen: die Schrittfolge eines Projekts einmal festhalten und
-- auf andere Projekte übertragen. Übernommen wird nur der Text – Frist und
-- Zuständige gehören zum einzelnen Bau, nicht zur Vorlage.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

alter table public.todos
  add column if not exists meilenstein boolean not null default false;

comment on column public.todos.meilenstein is
  'Kennzeichen für die festen Schritte eines Projekts. Sonst eine gewöhnliche '
  'Aufgabe – abhakbar, kommentierbar, mit Frist und Zuständigen.';

-- Meilensteine stehen zuoberst; der Index bedient genau diese Sortierung.
create index if not exists todos_meilenstein_idx
  on public.todos (project_id, meilenstein, order_index);

-- ---------------------------------------------------------------------------
-- Vorlagen: eine Schrittfolge mit Namen.
-- ---------------------------------------------------------------------------

create table if not exists public.milestone_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists public.milestone_template_items (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.milestone_templates (id) on delete cascade,
  text        text not null,
  sortierung  integer not null default 0
);

create index if not exists milestone_template_items_idx
  on public.milestone_template_items (template_id, sortierung);

alter table public.milestone_templates enable row level security;
alter table public.milestone_template_items enable row level security;

-- Vorlagen sind unsere Arbeitsvorbereitung – Lieferanten geht das nichts an.
-- Die Meilensteine selbst sehen sie sehr wohl: Das sind gewöhnliche Aufgaben
-- und folgen deren Regeln.
drop policy if exists milestone_templates_admin on public.milestone_templates;
create policy milestone_templates_admin on public.milestone_templates
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists milestone_template_items_admin on public.milestone_template_items;
create policy milestone_template_items_admin on public.milestone_template_items
  for all using (public.is_admin()) with check (public.is_admin());

comment on table public.milestone_templates is
  'Schrittfolge eines Projekts zum Wiederverwenden. Nur für die Swiss Solar '
  'Ventures AG.';

-- Kontrolle:
--   select v.name, count(*) as schritte
--     from public.milestone_templates v
--     left join public.milestone_template_items p on p.template_id = v.id
--    group by v.name;
--
--   select p.name as projekt, t.text, t.due_date, t.done
--     from public.todos t
--     join public.projects p on p.id = t.project_id
--    where t.meilenstein
--    order by p.name, t.order_index;
