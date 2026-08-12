-- =============================================================================
-- Baukoordination – Erweiterung 5: Profilbilder
--
-- Bauherrenvertreter und Lieferanten können ein Bild hinterlegen. Es ersetzt in
-- der Oberfläche den Kreis mit den Initialen.
--
-- Im Supabase SQL-Editor ausführen. Idempotent.
-- =============================================================================

alter table public.admins
  add column if not exists avatar_path text;

alter table public.suppliers
  add column if not exists avatar_path text;

-- Eigener, privater Ablageort. Wie bei den Projektdateien gibt es keine
-- Storage-Policies: Jeder Zugriff läuft über die App, die vorher prüft und
-- danach eine kurzlebige Signatur ausstellt.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Die beiden Sichten müssen den Pfad mitliefern, sonst sähe ein Lieferant die
-- Bilder seiner Ansprechpartner nicht.
-- -----------------------------------------------------------------------------

drop view if exists public.admin_public;
create view public.admin_public
with (security_invoker = off) as
select a.user_id, a.name, a.firma, a.funktion, a.avatar_path
from public.admins a;

grant select on public.admin_public to anon, authenticated;

drop view if exists public.supplier_public;
create view public.supplier_public
with (security_invoker = off) as
select s.id, s.name, s.firma, s.gewerk, s.avatar_path
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
