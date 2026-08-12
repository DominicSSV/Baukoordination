-- =============================================================================
-- Baukoordination – Erweiterung 2
--
--   1. Bauherrenvertreter bekommen ein Profil (Name, Firma, Funktion)
--   2. Aufgaben lassen sich einer einzelnen Person zuweisen, nicht nur "intern"
--   3. Lieferanten dürfen eigene Aufgaben erstellen und der SSV zuweisen
--
-- Im Supabase SQL-Editor ausführen, nachdem 0001_init.sql gelaufen ist.
-- Idempotent: darf mehrfach ausgeführt werden.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Profil der Bauherrenvertreter
-- -----------------------------------------------------------------------------

alter table public.admins
  add column if not exists firma text not null default 'Swiss Solar Ventures AG';

alter table public.admins
  add column if not exists funktion text;

-- Wer künftig als Bauherrenvertreter freigeschaltet werden soll, steht hier drin.
-- Legt jemand aus dieser Liste einen Auth-Account an, wird er automatisch mit dem
-- passenden Profil freigeschaltet – ohne zusätzlichen SQL-Befehl von Hand.
create table if not exists public.admin_seed (
  email    text primary key,
  name     text not null,
  firma    text not null default 'Swiss Solar Ventures AG',
  funktion text
);

insert into public.admin_seed (email, name, firma, funktion) values
  ('dominic.maag@swiss-sv.ch', 'Dominic Maag',    'Swiss Solar Ventures AG', 'Projektmanagement'),
  ('m.maerki@swiss-sv.ch',     'Maurice Märki',   'Swiss Solar Ventures AG', 'CEO'),
  ('v.gantner@swiss-sv.ch',    'Valentin Gantner','Swiss Solar Ventures AG', 'Administration')
on conflict (email) do update
  set name = excluded.name,
      firma = excluded.firma,
      funktion = excluded.funktion;

-- Bereits bestehende Konten nachträglich mit dem Profil versehen.
insert into public.admins (user_id, name, email, firma, funktion)
select u.id, s.name, u.email, s.firma, s.funktion
from auth.users u
join public.admin_seed s on lower(s.email) = lower(u.email)
on conflict (user_id) do update
  set name = excluded.name,
      firma = excluded.firma,
      funktion = excluded.funktion,
      email = excluded.email;

-- Neue Konten: erst die Liste prüfen, sonst wie bisher der Erste-Benutzer-Fall.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seed public.admin_seed%rowtype;
begin
  select * into v_seed
  from public.admin_seed
  where lower(email) = lower(new.email);

  if found then
    insert into public.admins (user_id, name, email, firma, funktion)
    values (new.id, v_seed.name, new.email, v_seed.firma, v_seed.funktion)
    on conflict (user_id) do update
      set name = excluded.name,
          firma = excluded.firma,
          funktion = excluded.funktion;
    return new;
  end if;

  -- Kein Eintrag in der Liste: nur der allererste Account wird freigeschaltet,
  -- damit eine Selbstregistrierung nicht automatisch Admin-Rechte bekommt.
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id, name, email)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
      new.email
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.admin_seed enable row level security;

drop policy if exists admin_seed_admin on public.admin_seed;
create policy admin_seed_admin on public.admin_seed
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. Namen der Bauherrenvertreter für Lieferanten sichtbar machen
--
-- Ein Lieferant muss eine Aufgabe einer bestimmten Person zuweisen können und
-- dafür deren Namen sehen. Die View gibt Name, Firma und Funktion heraus – die
-- E-Mail-Adressen bleiben in der Tabelle admins und damit unter Verschluss.
-- -----------------------------------------------------------------------------

drop view if exists public.admin_public;
create view public.admin_public
with (security_invoker = off) as
select a.user_id, a.name, a.firma, a.funktion
from public.admins a;

grant select on public.admin_public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Zuweisung an einzelne Personen
--
-- todos.assigned_to kannte bisher 'internal' oder eine blanke Lieferanten-ID.
-- Neu mit eindeutigem Präfix, damit Personen und Firmen unterscheidbar sind:
--
--   'internal'         -> Swiss Solar Ventures AG allgemein
--   'admin:<uuid>'     -> eine bestimmte Person der Swiss Solar Ventures AG
--   'supplier:<uuid>'  -> ein Lieferant
-- -----------------------------------------------------------------------------

update public.todos
set assigned_to = 'supplier:' || assigned_to
where assigned_to <> 'internal'
  and assigned_to not like 'supplier:%'
  and assigned_to not like 'admin:%';

-- -----------------------------------------------------------------------------
-- 4. Lieferanten dürfen eigene Aufgaben erstellen
--
-- Weiterhin gilt: fremde Aufgaben darf ein Lieferant nur abhaken. Das erzwingt
-- unverändert der Trigger todos_supplier_update_guard aus 0001_init.sql.
-- -----------------------------------------------------------------------------

drop policy if exists todos_insert on public.todos;
create policy todos_insert on public.todos
  for insert with check (
    public.is_admin()
    or (
      public.current_supplier_id() is not null
      and public.has_project_access(project_id)
      -- Ein Lieferant kann eine Aufgabe nur in eigenem Namen anlegen.
      and created_by_supplier_id = public.current_supplier_id()
    )
  );

-- Löschen: der Admin alles, ein Lieferant nur selbst erstellte Aufgaben.
drop policy if exists todos_delete on public.todos;
create policy todos_delete on public.todos
  for delete using (
    public.is_admin()
    or (
      created_by_supplier_id is not null
      and created_by_supplier_id = public.current_supplier_id()
    )
  );
