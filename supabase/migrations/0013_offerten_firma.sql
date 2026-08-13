-- =============================================================================
-- Baukoordination – Migration 13: Offerten je Firma statt je Person
--
-- Mehrere Ansprechpersonen derselben Firma (z.B. Mergim und Stive) arbeiten am
-- selben Angebot. Sie sehen deshalb die Offerten ihrer Firma gemeinsam –
-- weiterhin aber nichts von anderen Firmen. Wir sehen wie bisher alles.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0012 voraus.
-- =============================================================================

-- 0) Zusätzlicher Ordner "Auftragsbestätigung" --------------------------------
alter table public.files drop constraint if exists files_offer_folder_check;
alter table public.files
  add constraint files_offer_folder_check
  check (
    offer_folder is null
    or offer_folder in (
      'kostenschaetzung',
      'richtofferte',
      'offerte',
      'auftragsbestaetigung',
      'nachtrag'
    )
  );

-- 1) Firma eines Lieferanten, normalisiert ------------------------------------
-- Gross-/Kleinschreibung und Leerzeichen sollen nicht darüber entscheiden, wer
-- zusammengehört. Ohne Firmeneintrag gibt es keine Zusammengehörigkeit – sonst
-- wären alle Lieferanten ohne Firma plötzlich eine einzige Gruppe.
create or replace function public.supplier_firma(p_supplier uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(lower(firma)), '')
    from public.suppliers
   where id = p_supplier;
$$;

-- 2) Darf der angemeldete Lieferant diese Offerte sehen? ----------------------
create or replace function public.darf_offerte_sehen(p_uploader uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_uploader is null then false
    when public.current_supplier_id() is null then false
    when p_uploader = public.current_supplier_id() then true
    else coalesce(
      public.supplier_firma(p_uploader) is not null
      and public.supplier_firma(p_uploader)
          = public.supplier_firma(public.current_supplier_id()),
      false
    )
  end;
$$;

grant execute on function public.supplier_firma(uuid) to anon, authenticated;
grant execute on function public.darf_offerte_sehen(uuid) to anon, authenticated;

-- 3) Sichtbarkeit der Dateien -------------------------------------------------
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    public.has_project_access(project_id)
    and (
      offer_folder is null
      or public.is_admin()
      or public.darf_offerte_sehen(uploaded_by_supplier_id)
    )
  );

-- 4) Sichtbarkeit der Protokolleinträge zu Offerten ---------------------------
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity
  for select using (
    public.has_project_access(project_id)
    and (
      supplier_id is null
      or public.is_admin()
      or public.darf_offerte_sehen(supplier_id)
    )
  );

-- Kontrolle – zeigt, welche Lieferanten als eine Firma gelten:
--   select coalesce(public.supplier_firma(id), '(ohne Firma)') as firma,
--          string_agg(coalesce(name, '?'), ', ' order by name) as personen
--     from public.suppliers
--    group by 1
--    order by 1;
