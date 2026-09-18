-- =============================================================================
-- Baukoordination – Migration 35: Erinnerung am Vortag
--
-- Bisher meldete sich die App erst, wenn eine Frist bereits überschritten war.
-- Das ist zu spät: Wer am Morgen erfährt, dass etwas gestern fällig gewesen
-- wäre, kann nur noch entschuldigen. Neu geht am Vortag eine Erinnerung
-- hinaus – rechtzeitig, um den Tag danach einzuplanen.
--
-- Dafür braucht es einen eigenen Vermerk. Der bestehende overdue_notified_at
-- hält fest, dass gemahnt wurde; würde die Erinnerung ihn mitbenutzen, unter-
-- drückte die eine Meldung die andere: Wer am Vortag erinnert wurde, bekäme
-- keine Mahnung mehr, und umgekehrt.
--
-- Wird die Frist später verschoben, setzt die Aufgaben-Route beide Vermerke
-- zurück – dann wird für den neuen Termin erneut erinnert und gemahnt.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0004 voraus (dort entsteht die Spalte due_date).
-- =============================================================================

alter table public.todos
  add column if not exists erinnert_am timestamptz;

comment on column public.todos.erinnert_am is
  'Wann an die morgen ablaufende Frist erinnert wurde. Null = noch nicht. '
  'Getrennt von overdue_notified_at, damit sich Erinnerung und Mahnung nicht '
  'gegenseitig unterdrücken.';

-- Der tägliche Prüflauf sucht genau nach dieser Kombination.
create index if not exists todos_erinnerung_idx
  on public.todos (due_date, erinnert_am)
  where done = false and deleted_at is null;

-- Kontrolle: Was geht beim nächsten Lauf hinaus?
--   select text, due_date, erinnert_am, overdue_notified_at
--     from public.todos
--    where done = false and deleted_at is null and due_date is not null
--    order by due_date;
