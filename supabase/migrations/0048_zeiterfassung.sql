-- =============================================================================
-- Baukoordination – Migration 48: Zeiterfassung für Lieferanten
--
-- Ein neues Register im Projekt, hinter "Dateien". Wer freigeschaltet ist,
-- trägt dort Datum und Stunden ein; die Summe steht oben. Wir sehen alles,
-- je Firma und insgesamt.
--
-- Drei Entscheidungen, die hier festgeschrieben sind:
--
-- 1. FREIGABE JE PROJEKT UND FIRMA, nicht für alle. Wer auf der Baustelle im
--    Stundenlohn arbeitet, erfasst Zeit; wer pauschal offeriert hat, geht das
--    nichts an – und er soll das Register gar nicht erst sehen. Die Freigabe
--    steht deshalb in project_access, wo ohnehin steht, wer zu einem Projekt
--    gehört.
--
-- 2. JEDER SIEHT NUR SEINE EIGENEN STUNDEN. Was die andere Firma braucht und
--    was sie verlangt, ist deren Sache. Das erzwingt die Datenbank selbst
--    (Policy unten) und nicht bloss die Ansicht.
--
-- 3. DER STUNDENSATZ WIRD BEIM EINTRAG MITGESCHRIEBEN. Er steht beim
--    Lieferanten, ist aber in jeder Zeile nochmals festgehalten. Wer im März
--    zu 95 Franken gearbeitet hat und im Juli auf 105 erhöht, hat im März
--    trotzdem zu 95 gearbeitet. Ein Satz, der rückwirkend alle alten Zeilen
--    ändert, wäre eine falsche Rechnung.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

-- 1) Wer darf -----------------------------------------------------------------
alter table public.project_access
  add column if not exists zeiterfassung boolean not null default false;

comment on column public.project_access.zeiterfassung is
  'true = dieser Lieferant sieht im Projekt das Register "Zeiterfassung" und '
  'darf dort Stunden eintragen. Standard false: Wer pauschal offeriert hat, '
  'soll das Register gar nicht erst sehen.';

-- 2) Der Stundensatz der Firma ------------------------------------------------
--
-- Freiwillig. Ohne ihn zählt die Zeiterfassung Stunden und sonst nichts – für
-- manche genügt genau das.
alter table public.suppliers
  add column if not exists stundensatz numeric(10, 2);

comment on column public.suppliers.stundensatz is
  'Ansatz in Franken je Stunde. Null = keiner hinterlegt; dann werden nur '
  'Stunden gezählt, kein Betrag.';

-- 3) Die Einträge --------------------------------------------------------------
create table if not exists public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  datum       date not null,
  -- In Stunden, mit zwei Nachkommastellen: 1.5 ist anderthalb Stunden.
  -- Minuten als eigene Spalte wären genauer, als auf dem Bau gearbeitet wird.
  stunden     numeric(6, 2) not null check (stunden > 0 and stunden <= 24),
  beschreibung text,
  -- Der Satz zum Zeitpunkt der Erfassung. Siehe Entscheidung 3 oben.
  satz        numeric(10, 2),
  erfasst_von text,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

comment on table public.time_entries is
  'Erfasste Arbeitszeit je Projekt und Lieferant. Jeder sieht nur seine '
  'eigenen Zeilen; wir sehen alle.';

create index if not exists time_entries_projekt_idx
  on public.time_entries (project_id, datum desc);

create index if not exists time_entries_firma_idx
  on public.time_entries (supplier_id, datum desc);

-- 4) Zugriff -------------------------------------------------------------------
alter table public.time_entries enable row level security;

-- Lesen: wir alles, ein Lieferant nur seine eigenen Zeilen.
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select
  using (
    exists (select 1 from public.admins a where a.user_id = auth.uid())
    or supplier_id = public.current_supplier_id()
  );

-- Schreiben läuft über den Dienstschlüssel; dort prüft die App vorher die
-- Freigabe. Die Regel hier ist der zweite Riegel für den Fall, dass jemand
-- mit einem Lieferanten-Schlüssel direkt an die Datenbank ginge.
drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries
  for insert
  with check (
    supplier_id = public.current_supplier_id()
    and exists (
      select 1 from public.project_access pa
      where pa.project_id = time_entries.project_id
        and pa.supplier_id = public.current_supplier_id()
        and pa.zeiterfassung = true
    )
  );

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update
  using (supplier_id = public.current_supplier_id())
  with check (supplier_id = public.current_supplier_id());

drop policy if exists time_entries_delete on public.time_entries;
create policy time_entries_delete on public.time_entries
  for delete
  using (supplier_id = public.current_supplier_id());

-- Kontrolle: Wer ist wo freigeschaltet, und wie viele Stunden stehen da?
--   select p.name as projekt,
--          s.firma,
--          pa.zeiterfassung as freigeschaltet,
--          coalesce(sum(t.stunden), 0) as stunden
--     from public.project_access pa
--     join public.projects p  on p.id = pa.project_id
--     join public.suppliers s on s.id = pa.supplier_id
--     left join public.time_entries t
--            on t.project_id = pa.project_id and t.supplier_id = pa.supplier_id
--    group by p.name, s.firma, pa.zeiterfassung
--    order by p.name, s.firma;
