-- =============================================================================
-- Baukoordination – Migration 35: Erinnerungen vor der Frist
--
-- Bisher meldete sich die App erst, wenn eine Frist bereits überschritten war.
-- Das ist zu spät: Wer am Morgen erfährt, dass etwas gestern fällig gewesen
-- wäre, kann nur noch entschuldigen.
--
-- Neu gibt es zwei Erinnerungen davor – am Vortag und am Tag selbst, beide um
-- halb acht. Die erste, um den Tag einzuplanen; die zweite, weil zwischen
-- gestern Abend und heute Morgen viel dazwischenkommt.
--
-- Jede Stufe braucht einen eigenen Vermerk. Mit einem gemeinsamen unterdrückte
-- die eine Meldung die anderen: Wer am Vortag erinnert wurde, bekäme am Tag
-- selbst nichts mehr und später auch keine Mahnung.
--
-- Wird die Frist später verschoben, setzt die Aufgaben-Route alle drei Vermerke
-- zurück – dann wird für den neuen Termin erneut erinnert und gemahnt.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0004 voraus (dort entsteht die Spalte due_date).
-- =============================================================================

alter table public.todos
  add column if not exists erinnert_am timestamptz,
  add column if not exists erinnert_heute_am timestamptz;

comment on column public.todos.erinnert_am is
  'Wann an die morgen ablaufende Frist erinnert wurde. Null = noch nicht.';

comment on column public.todos.erinnert_heute_am is
  'Wann am Tag der Frist erinnert wurde. Null = noch nicht. Eigene Spalte, '
  'damit die Erinnerung vom Vortag diese hier nicht unterdrückt.';

-- Der tägliche Prüflauf sucht genau nach diesen Kombinationen.
create index if not exists todos_erinnerung_idx
  on public.todos (due_date, erinnert_am)
  where done = false and deleted_at is null;

create index if not exists todos_erinnerung_heute_idx
  on public.todos (due_date, erinnert_heute_am)
  where done = false and deleted_at is null;

-- Kontrolle: Was geht beim nächsten Lauf hinaus?
--   select text, due_date, erinnert_am, erinnert_heute_am, overdue_notified_at
--     from public.todos
--    where done = false and deleted_at is null and due_date is not null
--    order by due_date;
