-- =============================================================================
-- Baukoordination – Migration 12: Offerten
--
-- Neues Register "Offerten" mit vier Ordnern. Lieferanten laden dort ihre
-- Unterlagen hoch und sehen ausschliesslich ihre eigenen; die Swiss Solar
-- Ventures AG sieht alle – auch im Register "Dateien".
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- =============================================================================

-- 1) Ordner an der Datei ------------------------------------------------------
alter table public.files
  add column if not exists offer_folder text;

-- Erlaubt sind nur die vier Ordner; null = gewöhnliche Datei.
alter table public.files drop constraint if exists files_offer_folder_check;
alter table public.files
  add constraint files_offer_folder_check
  check (
    offer_folder is null
    or offer_folder in ('kostenschaetzung', 'richtofferte', 'offerte', 'nachtrag')
  );

create index if not exists files_offer_idx
  on public.files (project_id, offer_folder, uploaded_at desc);

-- 2) Sichtbarkeit -------------------------------------------------------------
-- Offerten sind vertraulich: ein Lieferant sieht nur die eigenen, wir alle.
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    public.has_project_access(project_id)
    and (
      offer_folder is null
      or public.is_admin()
      or uploaded_by_supplier_id = public.current_supplier_id()
    )
  );

-- 3) Protokolleinträge, die nur uns und den Hochladenden etwas angehen ---------
-- Ohne das stünde im Protokoll für alle lesbar, wer wann eine Offerte
-- eingereicht hat. supplier_id = null heisst wie bisher: für alle sichtbar.
alter table public.activity
  add column if not exists supplier_id uuid references public.suppliers(id) on delete cascade;

drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity
  for select using (
    public.has_project_access(project_id)
    and (
      supplier_id is null
      or public.is_admin()
      or supplier_id = public.current_supplier_id()
    )
  );

-- Kontrolle:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'files' and column_name = 'offer_folder';
