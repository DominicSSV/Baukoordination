-- =============================================================================
-- Baukoordination – Migration 47: Mehrere Bilder je Liegenschaft
--
-- Bisher hatte ein Projekt genau ein Foto. Für "ist das die richtige Adresse"
-- reicht das; für alles andere nicht. Eine Liegenschaft hat ein Dach, eine
-- Zufahrt, einen Zählerkasten und eine Stelle, an der der Wechselrichter
-- hängen soll – und wer das zweite Foto hochlud, löschte damit das erste.
--
-- Neu liegen die Bilder in einer eigenen Tabelle, beliebig viele, in einer
-- verschiebbaren Reihenfolge.
--
-- projects.bild_path bleibt bestehen und zeigt weiterhin auf das erste Bild.
-- Das ist bewusst doppelt gehalten: Die Projektliste, die Sicherung und die
-- Gesundheitsprüfung lesen diese Spalte. Sie mitzuführen kostet eine Zeile im
-- Code und erspart es, fünf Stellen gleichzeitig umzubauen – und wer die App
-- auf einem älteren Stand öffnet, sieht wenigstens das Titelbild statt gar
-- nichts.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0034 voraus.
-- =============================================================================

create table if not exists public.project_bilder (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Der Pfad im Ablageort "avatars", z.B. "projekte/<id>/<zufall>.jpg".
  pfad       text not null,
  -- Die Reihenfolge in der Ansicht. Zehnerschritte, damit sich später etwas
  -- dazwischenschieben lässt, ohne alles neu zu nummerieren.
  order_index integer not null default 0,
  titel      text,
  created_at timestamptz not null default now(),
  created_by text
);

comment on table public.project_bilder is
  'Die Fotos einer Liegenschaft. Das erste ist das Titelbild und steht '
  'zusätzlich in projects.bild_path.';

create index if not exists project_bilder_projekt_idx
  on public.project_bilder (project_id, order_index);

-- Ein Bild soll nicht zweimal in derselben Liste stehen. Das passiert sonst
-- beim zweiten Durchlauf dieser Migration oder wenn ein Upload wiederholt
-- gemeldet wird.
create unique index if not exists project_bilder_pfad_idx
  on public.project_bilder (project_id, pfad);

-- --- Die bisherigen Bilder übernehmen ---------------------------------------
--
-- Jedes Projekt, das schon ein Bild hat, bekommt es als erstes der neuen
-- Liste. Ohne diesen Schritt wären alle bisherigen Fotos auf einen Schlag
-- unsichtbar – obwohl sie im Speicher unverändert liegen.
insert into public.project_bilder (project_id, pfad, order_index)
select p.id, p.bild_path, 0
from public.projects p
where p.bild_path is not null
on conflict (project_id, pfad) do nothing;

-- --- Zugriff -----------------------------------------------------------------
--
-- Dieselbe Regel wie bei den übrigen Projektinfos: Wer das Projekt sehen darf,
-- sieht auch die Bilder. Geschrieben wird ausschliesslich über den
-- Dienstschlüssel, und dort prüft die App vorher den Zugriff – deshalb hier
-- nur eine Leseregel.
alter table public.project_bilder enable row level security;

drop policy if exists project_bilder_select on public.project_bilder;
create policy project_bilder_select on public.project_bilder
  for select
  using (
    exists (
      select 1 from public.admins a where a.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.project_access pa
      where pa.project_id = project_bilder.project_id
        and pa.supplier_id = public.current_supplier_id()
    )
  );

-- Kontrolle: Wie viele Bilder hat welches Projekt?
--   select p.name, count(b.id) as bilder
--     from public.projects p
--     left join public.project_bilder b on b.project_id = p.id
--    group by p.name
--    order by p.name;
