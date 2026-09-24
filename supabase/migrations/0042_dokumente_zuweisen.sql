-- =============================================================================
-- Baukoordination – Migration 42: Auftragsbestätigungen & Nachträge zuweisen
--
-- Das Register hiess "Offerten" und hatte fünf Ordner. Übrig bleiben zwei:
-- Auftragsbestätigungen und Nachträge. Das sind die beiden, die auf der
-- Baustelle wirklich zirkulieren.
--
-- Neu wird beim Hochladen bestimmt, WER das Dokument sehen darf. Bisher galt
-- die Firma des Einreichers – das passt für eine Offerte, die eine Firma
-- abgibt, aber nicht für eine Auftragsbestätigung, die wir jemandem zustellen.
--
-- Die Regel danach:
--   * Wir sehen alles. Wer die Baustelle koordiniert, muss jedes Papier
--     nachschlagen können; ein Dokument, das uns selbst verborgen bleibt,
--     wäre in einem Koordinationswerkzeug ein Widerspruch.
--   * Ein Lieferant sieht es, wenn er zugewiesen wurde – oder wenn er es
--     selbst hochgeladen hat. Niemand soll die eigene Einreichung verlieren,
--     weil er sich beim Zuweisen selbst vergessen hat.
--   * Ist niemand zugewiesen, sehen es nur wir. Eine leere Liste heisst
--     ausdrücklich "für uns", nicht "für alle": Beim Zuweisen etwas zu
--     vergessen darf nicht dazu führen, dass ein Vertrag offen herumliegt.
--
-- ALTBESTAND BLEIBT: Dateien in den früheren Ordnern (Kostenschätzung,
-- Richtofferte, Offerte) werden nicht angefasst und nicht gelöscht. Die
-- Prüfregel der Spalte lässt sie weiterhin zu, und die App zeigt solche
-- Ordner weiter an, solange etwas darin liegt – nur neu einreichen lässt
-- sich dort nichts mehr.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt die Migrationen 0012 und 0013 voraus.
-- =============================================================================

-- 1) Wer das Dokument sehen darf -----------------------------------------------
--
-- Kennungen der Lieferanten als Text, damit dieselbe Schreibweise gilt wie bei
-- den Zuständigen einer Aufgabe. Null = noch nie zugewiesen (Altbestand),
-- leeres Feld = ausdrücklich nur wir.
alter table public.files
  add column if not exists sichtbar_fuer text[];

comment on column public.files.sichtbar_fuer is
  'Kennungen der Lieferanten, die dieses Dokument sehen dürfen. Leer = nur '
  'die Swiss Solar Ventures AG. Null = Altbestand, dann gilt die frühere '
  'Regel über die Firma des Einreichers.';

create index if not exists files_sichtbar_idx
  on public.files using gin (sichtbar_fuer);

-- 2) Die Regel in der Datenbank ------------------------------------------------
--
-- Sie steht hier und nicht nur in der Anwendung: Die Route liest teilweise mit
-- dem Dienstschlüssel, und eine Sperre, die nur im Bildschirm sitzt, ist keine.
create or replace function public.darf_dokument_sehen(
  p_sichtbar_fuer text[],
  p_uploader uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Wir sehen alles.
  if public.is_admin() then
    return true;
  end if;

  -- Selbst hochgeladen: immer sichtbar. Wer sich beim Zuweisen vergisst, soll
  -- nicht das eigene Papier verlieren.
  if p_uploader is not null and p_uploader = public.current_supplier_id() then
    return true;
  end if;

  -- Altbestand ohne Zuweisung: die frühere Regel über die Firma.
  if p_sichtbar_fuer is null then
    return public.darf_offerte_sehen(p_uploader);
  end if;

  -- Ausdrücklich zugewiesen?
  return public.current_supplier_id()::text = any (p_sichtbar_fuer);
end;
$$;

-- 3) Sichtbarkeit der Dateien --------------------------------------------------
drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    public.has_project_access(project_id)
    and (
      offer_folder is null
      or public.is_admin()
      or public.darf_dokument_sehen(sichtbar_fuer, uploaded_by_supplier_id)
    )
  );

-- Kontrolle: Was liegt wo, und wer darf es sehen?
--   select p.name as projekt,
--          f.offer_folder,
--          f.name,
--          coalesce(array_length(f.sichtbar_fuer, 1), 0) as zugewiesene,
--          case when f.sichtbar_fuer is null then 'Altbestand'
--               when array_length(f.sichtbar_fuer, 1) is null then 'nur wir'
--               else 'zugewiesen' end as sichtbarkeit
--     from public.files f
--     join public.projects p on p.id = f.project_id
--    where f.offer_folder is not null
--      and f.deleted_at is null
--    order by p.name, f.offer_folder, f.uploaded_at desc;
