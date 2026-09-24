-- =============================================================================
-- Baukoordination – Migration 43: Gruppen über den Projekten
--
-- Die Seitenleiste gliederte bisher nur nach Phase: In Planung, In Umsetzung,
-- In Abschluss, Abgeschlossen. Bei fünf Projekten trug das; bei dreissig nicht
-- mehr – dann stehen Photovoltaik, Speicher und Heizungen durcheinander in
-- einer Liste "In Umsetzung".
--
-- Neu kommt eine Ebene DARÜBER: die Sparte. PVA, BESS, Abrechnungsmodell,
-- Sanierungen, Heizung. Die Phasen bleiben, wo sie sind, und stehen künftig
-- innerhalb der Sparte – zwei Ebenen, nicht zwei nebeneinanderliegende
-- Gliederungen.
--
-- Die Sparten sind eine Tabelle und keine feste Liste im Programm: Die
-- nächste kommt bestimmt, und dafür soll niemand den Code anfassen und neu
-- bereitstellen müssen. Die Reihenfolge ist verschiebbar.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich:
-- Die fünf Sparten werden nur angelegt, wenn es noch keine gibt.
-- Setzt Migration 0001 voraus.
-- =============================================================================

create table if not exists public.project_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Kleine Schritte zwischen den Zahlen, damit sich eine Sparte dazwischen
  -- schieben lässt, ohne alle anderen neu zu nummerieren.
  order_index integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists project_groups_reihenfolge_idx
  on public.project_groups (order_index, created_at);

-- Zuordnung am Projekt. Null heisst "noch keiner Sparte zugeteilt"; solche
-- Projekte sammelt die App am Ende unter "Ohne Gruppe" – sichtbar, nicht
-- verschwunden. Ein Projekt, das beim Aufräumen unsichtbar wird, ist das
-- Schlimmste, was eine Gliederung anrichten kann.
alter table public.projects
  add column if not exists group_id uuid references public.project_groups (id)
    on delete set null;

create index if not exists projects_gruppe_idx on public.projects (group_id);

comment on table public.project_groups is
  'Sparten über den Projekten: PVA, BESS, Heizung … Die Phase (In Planung, '
  'In Umsetzung …) bleibt am Projekt und gliedert innerhalb der Sparte.';

-- Lesen darf jeder Angemeldete: Die Namen der Sparten sind keine Geheimnisse,
-- und ohne sie stünde die Seitenleiste bei den Lieferanten ohne Gliederung da.
-- Geändert wird ausschliesslich über die App, die Adminrechte verlangt.
alter table public.project_groups enable row level security;

drop policy if exists project_groups_select on public.project_groups;
create policy project_groups_select on public.project_groups
  for select using (true);

-- Die fünf zum Anfangen – nur, wenn noch keine Sparte existiert. Wer sie
-- später umbenennt oder umsortiert, soll das beim nächsten Durchlauf nicht
-- zurückgesetzt bekommen.
insert into public.project_groups (name, order_index)
select * from (values
  ('PVA', 10),
  ('BESS', 20),
  ('Abrechnungsmodell', 30),
  ('Sanierungen', 40),
  ('Heizung', 50)
) as neu(name, order_index)
where not exists (select 1 from public.project_groups);

-- Kontrolle: Wie viele Projekte hängen an welcher Sparte?
--   select coalesce(g.name, '– ohne Gruppe –') as sparte,
--          g.order_index,
--          count(p.id) as projekte
--     from public.projects p
--     left join public.project_groups g on g.id = p.group_id
--    group by g.name, g.order_index
--    order by g.order_index nulls last;
