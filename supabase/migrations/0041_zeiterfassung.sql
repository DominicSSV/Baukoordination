-- =============================================================================
-- Baukoordination – Migration 41: Zeiterfassung
--
-- Wer wann wie lange an einem Projekt gearbeitet hat, mit Stundensatz und
-- Summe. Gedacht für die Lieferanten – die tragen später selbst ein, was sie
-- geleistet haben, statt am Monatsende aus dem Gedächtnis zu rekonstruieren.
--
-- VORERST SEHEN ES NUR WIR. Das Register ist für Lieferanten nicht sichtbar,
-- und die Route weist sie ab. Die Tabelle ist aber schon so gebaut, dass ein
-- Lieferant seine eigenen Stunden erfassen kann: supplier_id sagt, für wen
-- gearbeitet wurde, erfasst_von sagt, wer den Eintrag geschrieben hat. Damit
-- ist das Freischalten später eine Sache der Anwendung und keine der
-- Datenbank – und die Zahlen, die bis dahin bei uns entstehen, bleiben gültig.
--
-- Zugriff ausschliesslich über den Dienstschlüssel: Hier stehen Stundensätze
-- aller Firmen beieinander. Was die eine Firma verlangt, geht die andere
-- nichts an. Deshalb RLS ohne Regel; die App prüft in der Route.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

create table if not exists public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,

  -- Wer gearbeitet hat. Genau eines von beiden ist gesetzt.
  -- Beim Löschen eines Lieferanten bleibt der Eintrag stehen: Geleistete
  -- Stunden sind eine Tatsache und verschwinden nicht, weil jemand die Firma
  -- aus der App nimmt. Der Name unten hält fest, um wen es ging.
  supplier_id uuid references public.suppliers (id) on delete set null,
  admin_user_id uuid,

  -- Anzeigename und Firma zum Zeitpunkt der Erfassung. Wird jemand später
  -- umbenannt oder wechselt die Firma, stimmt die alte Abrechnung trotzdem.
  wer         text not null,
  firma       text,

  datum       date not null,
  -- Zwei Nachkommastellen genügen: 7.25 Stunden sind viertelstundengenau, und
  -- feiner rechnet auf der Baustelle niemand ab.
  stunden     numeric(6, 2) not null,
  -- Darf fehlen: Manchmal werden erst Stunden gesammelt und der Satz später
  -- verhandelt. Dann zählt die App die Stunden und lässt den Betrag offen.
  stundensatz numeric(8, 2),

  beschreibung text,

  -- Wer den Eintrag geschrieben hat – wir oder der Lieferant selbst.
  erfasst_von text,
  created_at  timestamptz not null default now(),

  constraint time_entries_stunden_sinnvoll
    check (stunden > 0 and stunden <= 24),
  constraint time_entries_satz_nicht_negativ
    check (stundensatz is null or stundensatz >= 0)
);

-- Das Register zeigt ein Projekt, nach Datum sortiert.
create index if not exists time_entries_projekt_idx
  on public.time_entries (project_id, datum desc, created_at desc);

-- Für die Auswertung je Firma.
create index if not exists time_entries_supplier_idx
  on public.time_entries (supplier_id, datum);

alter table public.time_entries enable row level security;

-- Keine Regel, also kein Zugriff ausser über den Dienstschlüssel.

comment on table public.time_entries is
  'Zeiterfassung je Projekt: Tag, Stunden, Stundensatz. Vorerst nur für die '
  'Swiss Solar Ventures AG sichtbar; die Spalten sind schon darauf ausgelegt, '
  'dass Lieferanten später selbst erfassen.';

comment on column public.time_entries.stundensatz is
  'CHF pro Stunde, exkl. MWST. Null = noch nicht vereinbart; dann zählt die '
  'App nur die Stunden.';

-- Kontrolle: Was ist je Projekt und Firma aufgelaufen?
--   select p.name as projekt,
--          coalesce(t.firma, t.wer) as firma,
--          sum(t.stunden)                                  as stunden,
--          sum(t.stunden * coalesce(t.stundensatz, 0))     as betrag
--     from public.time_entries t
--     join public.projects p on p.id = t.project_id
--    group by p.name, coalesce(t.firma, t.wer)
--    order by p.name, betrag desc;
