-- =============================================================================
-- Baukoordination – Swiss Solar Ventures AG
-- Schema, Rollen-Helfer und Row Level Security
--
-- Einmal komplett im Supabase SQL-Editor ausführen (Dashboard > SQL Editor).
-- Das Skript ist idempotent geschrieben und kann gefahrlos erneut laufen.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Tabellen
-- -----------------------------------------------------------------------------

-- Bauherrenvertreter. Ein Eintrag pro Supabase-Auth-Benutzer, der Admin sein darf.
-- Ersetzt das geteilte Namensfeld aus dem Prototyp durch echte Einzel-Accounts.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  ort        text,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text,                        -- Ansprechperson, Hauptanzeige
  firma       text,                        -- Firma, Zusatzanzeige
  gewerk      text,
  kontakt     text,                        -- Telefon
  email       text,
  access_code text not null unique,        -- 6-stellig, siehe genCode() im Frontend
  created_at  timestamptz not null default now(),
  constraint suppliers_name_or_firma check (
    coalesce(nullif(btrim(name), ''), nullif(btrim(firma), '')) is not null
  )
);

create table if not exists public.project_access (
  project_id  uuid not null references public.projects(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, supplier_id)
);

create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  text        text not null,
  assigned_to text not null default 'internal',   -- 'internal' oder suppliers.id als text
  done        boolean not null default false,
  done_by     text,
  done_at     timestamptz,
  created_by  text not null,                      -- Anzeigename
  -- Zusatz gegenüber der Spezifikation: die reine Namensgleichheit aus dem Prototyp
  -- ist als Besitz-Nachweis in RLS nicht fälschungssicher. Die ID daneben ist es.
  created_by_supplier_id uuid references public.suppliers(id) on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  order_index integer not null default 0          -- manuelle Sortierung per Pfeil-Buttons
);

create index if not exists todos_project_order_idx
  on public.todos (project_id, order_index, created_at);

create table if not exists public.todo_comments (
  id         uuid primary key default gen_random_uuid(),
  todo_id    uuid not null references public.todos(id) on delete cascade,
  text       text not null,
  author     text not null,
  author_supplier_id uuid references public.suppliers(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists todo_comments_todo_idx on public.todo_comments (todo_id, created_at);

create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  todo_id      uuid references public.todos(id) on delete set null, -- null = allgemeine Datei
  name         text not null,
  mime_type    text,
  size_bytes   bigint,
  storage_path text not null,               -- Pfad im Bucket project-files
  thumb_path   text,                        -- verkleinerte Vorschau bei Bildern
  uploaded_by  text not null,
  uploaded_by_supplier_id uuid references public.suppliers(id) on delete set null,
  uploaded_at  timestamptz not null default now()
);

create index if not exists files_project_idx on public.files (project_id, uploaded_at desc);

create table if not exists public.activity (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_name text not null,
  text       text not null,
  icon       text,
  created_at timestamptz not null default now()
);

create index if not exists activity_project_idx on public.activity (project_id, created_at desc);

create table if not exists public.app_settings (
  key   text primary key,
  value text
);

-- Angemeldete Lieferanten. Der Browser hält nur ein zufälliges Token, hier liegt
-- der Hash davon – so bleibt der Login über Tage bestehen und lässt sich jederzeit
-- widerrufen (beim Löschen des Lieferanten räumt das ON DELETE CASCADE mit auf).
create table if not exists public.supplier_sessions (
  token_hash  text primary key,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  user_agent  text
);

create index if not exists supplier_sessions_supplier_idx
  on public.supplier_sessions (supplier_id);

-- Audit-Log über Änderungen an Zugriffsrechten (Punkt 7 der Spezifikation)
create table if not exists public.access_audit (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  action      text not null,           -- 'grant' | 'revoke' | 'supplier_deleted'
  actor       text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. Rollen-Helfer
--
-- Admin  = eingeloggter Supabase-Auth-Benutzer, der in public.admins steht.
-- Lieferant = Inhaber eines vom Server signierten JWT mit dem Claim supplier_id.
-- -----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

create or replace function public.current_supplier_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'supplier_id',
      ''
    ),
    ''
  )::uuid;
$$;

-- Darf der aktuelle Aufrufer dieses Projekt sehen?
create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_admin()
    or (
      public.current_supplier_id() is not null
      and exists (
        select 1
        from public.project_access pa
        where pa.project_id = p_project_id
          and pa.supplier_id = public.current_supplier_id()
      )
    );
$$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.current_supplier_id() to anon, authenticated;
grant execute on function public.has_project_access(uuid) to anon, authenticated;

-- Erster Auth-Benutzer wird automatisch Admin. Jeder weitere Account muss von einem
-- bestehenden Admin freigeschaltet werden – sonst wäre jede Selbstregistrierung ein Admin.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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

-- -----------------------------------------------------------------------------
-- 3. Schreib-Wächter für Lieferanten
--
-- RLS kann Zeilen filtern, aber keine einzelnen Spalten. Ein Lieferant darf ein
-- fremdes To-Do nur abhaken – Text, Zuweisung und Reihenfolge bleiben tabu.
-- Genau das erzwingt dieser Trigger, zusätzlich zu den Policies weiter unten.
-- -----------------------------------------------------------------------------

create or replace function public.todos_supplier_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supplier uuid := public.current_supplier_id();
begin
  -- Admins und serverseitige Aufrufe mit service_role laufen ungehindert durch.
  if v_supplier is null then
    return new;
  end if;

  -- Eigenes To-Do: darf inhaltlich bearbeitet werden.
  if old.created_by_supplier_id is not null
     and old.created_by_supplier_id = v_supplier then
    if new.project_id is distinct from old.project_id then
      raise exception 'Ein To-Do kann nicht in ein anderes Projekt verschoben werden.';
    end if;
    return new;
  end if;

  -- Fremdes To-Do: ausschliesslich der Erledigt-Status darf sich ändern.
  if new.text            is distinct from old.text
     or new.assigned_to  is distinct from old.assigned_to
     or new.project_id   is distinct from old.project_id
     or new.order_index  is distinct from old.order_index
     or new.created_by   is distinct from old.created_by
     or new.created_by_supplier_id is distinct from old.created_by_supplier_id
     or new.created_at   is distinct from old.created_at then
    raise exception 'Lieferanten dürfen fremde To-Dos nur abhaken, nicht bearbeiten.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists todos_supplier_update_guard on public.todos;
create trigger todos_supplier_update_guard
  before update on public.todos
  for each row execute function public.todos_supplier_update_guard();

-- -----------------------------------------------------------------------------
-- 4. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.admins         enable row level security;
alter table public.projects       enable row level security;
alter table public.suppliers      enable row level security;
alter table public.project_access enable row level security;
alter table public.todos          enable row level security;
alter table public.todo_comments  enable row level security;
alter table public.files          enable row level security;
alter table public.activity       enable row level security;
alter table public.app_settings   enable row level security;
alter table public.access_audit   enable row level security;
-- supplier_sessions bekommt bewusst keine einzige Policy: RLS ist aktiv, also kommt
-- ausser der service_role (die RLS umgeht) niemand an die Tabelle heran.
alter table public.supplier_sessions enable row level security;

-- admins -----------------------------------------------------------------
drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists admins_write on public.admins;
create policy admins_write on public.admins
  for all using (public.is_admin()) with check (public.is_admin());

-- projects ---------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (public.has_project_access(id));

drop policy if exists projects_admin_write on public.projects;
create policy projects_admin_write on public.projects
  for all using (public.is_admin()) with check (public.is_admin());

-- suppliers --------------------------------------------------------------
-- Lieferanten sehen ausschliesslich ihren eigenen Datensatz. Namen anderer
-- Lieferanten kommen über die View supplier_public (ohne access_code).
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select using (public.is_admin() or id = public.current_supplier_id());

drop policy if exists suppliers_admin_write on public.suppliers;
create policy suppliers_admin_write on public.suppliers
  for all using (public.is_admin()) with check (public.is_admin());

-- project_access ---------------------------------------------------------
drop policy if exists project_access_select on public.project_access;
create policy project_access_select on public.project_access
  for select using (public.is_admin() or supplier_id = public.current_supplier_id());

drop policy if exists project_access_admin_write on public.project_access;
create policy project_access_admin_write on public.project_access
  for all using (public.is_admin()) with check (public.is_admin());

-- todos ------------------------------------------------------------------
drop policy if exists todos_select on public.todos;
create policy todos_select on public.todos
  for select using (public.has_project_access(project_id));

-- Neue To-Dos legt ausschliesslich der Admin an.
drop policy if exists todos_insert on public.todos;
create policy todos_insert on public.todos
  for insert with check (public.is_admin());

-- Abhaken darf jeder mit Projektzugriff; was sich dabei ändern darf,
-- entscheidet der Trigger todos_supplier_update_guard.
drop policy if exists todos_update on public.todos;
create policy todos_update on public.todos
  for update using (public.has_project_access(project_id))
  with check (public.has_project_access(project_id));

drop policy if exists todos_delete on public.todos;
create policy todos_delete on public.todos
  for delete using (public.is_admin());

-- todo_comments ----------------------------------------------------------
drop policy if exists todo_comments_select on public.todo_comments;
create policy todo_comments_select on public.todo_comments
  for select using (
    exists (select 1 from public.todos t
            where t.id = todo_id and public.has_project_access(t.project_id))
  );

drop policy if exists todo_comments_insert on public.todo_comments;
create policy todo_comments_insert on public.todo_comments
  for insert with check (
    exists (select 1 from public.todos t
            where t.id = todo_id and public.has_project_access(t.project_id))
    and (
      public.is_admin()
      or author_supplier_id = public.current_supplier_id()
    )
  );

-- Eigene Kommentare sind löschbar, fremde nur für den Admin.
drop policy if exists todo_comments_delete on public.todo_comments;
create policy todo_comments_delete on public.todo_comments
  for delete using (
    public.is_admin()
    or (author_supplier_id is not null
        and author_supplier_id = public.current_supplier_id())
  );

-- files ------------------------------------------------------------------
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (public.has_project_access(project_id));

drop policy if exists files_insert on public.files;
create policy files_insert on public.files
  for insert with check (
    public.has_project_access(project_id)
    and (
      public.is_admin()
      or uploaded_by_supplier_id = public.current_supplier_id()
    )
  );

drop policy if exists files_delete on public.files;
create policy files_delete on public.files
  for delete using (
    public.is_admin()
    or (uploaded_by_supplier_id is not null
        and uploaded_by_supplier_id = public.current_supplier_id())
  );

-- activity ---------------------------------------------------------------
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity
  for select using (public.has_project_access(project_id));

drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity
  for insert with check (public.has_project_access(project_id));

drop policy if exists activity_admin_delete on public.activity;
create policy activity_admin_delete on public.activity
  for delete using (public.is_admin());

-- app_settings / access_audit -------------------------------------------
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists access_audit_admin on public.access_audit;
create policy access_audit_admin on public.access_audit
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 5. View: Lieferanten-Namen ohne Zugangscodes
--
-- Ein Lieferant muss lesen können, wem ein To-Do zugewiesen ist. Er darf dabei
-- weder access_code noch Kontaktdaten anderer Lieferanten sehen. Die View läuft
-- bewusst mit security_invoker = off und filtert selbst.
-- -----------------------------------------------------------------------------

drop view if exists public.supplier_public;
create view public.supplier_public
with (security_invoker = off) as
select s.id, s.name, s.firma, s.gewerk
from public.suppliers s
where
  public.is_admin()
  or s.id = public.current_supplier_id()
  or exists (
    select 1
    from public.project_access mine
    join public.project_access theirs on theirs.project_id = mine.project_id
    where mine.supplier_id = public.current_supplier_id()
      and theirs.supplier_id = s.id
  );

grant select on public.supplier_public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Storage
--
-- Privater Bucket. Es gibt bewusst keine Storage-Policies für anon/authenticated:
-- Jeder Zugriff läuft über die API-Routen der App, die vorher die Projektfreigabe
-- prüfen und danach eine kurzlebige Signed URL ausstellen.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;
