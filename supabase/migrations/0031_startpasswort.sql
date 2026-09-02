-- =============================================================================
-- Baukoordination – Migration 31: Das vergebene Startpasswort nachlesen können
--
-- Bei der Einführung vergibt die Swiss Solar Ventures AG die Passwörter und
-- teilt sie den Firmen mit. Bei zwanzig Firmen weiss man nach drei Tagen nicht
-- mehr, wer welches bekommen hat – und "setz halt ein neues" heisst jedes Mal
-- ein Anruf.
--
-- Deshalb wird das vergebene Passwort hier zusätzlich im Klartext abgelegt,
-- damit es in den Kontakten nachlesbar ist.
--
-- Das ist vertretbar, weil die Lieferanten ihr Passwort nicht selbst wählen:
-- Es kommt immer von uns. Damit ist es ein ausgegebener Firmenzugang und kein
-- persönliches Passwort, das jemand womöglich auch für sein Mailkonto braucht.
-- Genau diesen Fall wollen wir nicht lesen können – und deshalb gibt es ihn
-- in dieser App gar nicht erst.
--
-- Sagt den Firmen trotzdem: Dieses Passwort gilt nur hier, es gehört nirgends
-- sonst hin.
--
-- Für die Anmeldung zählt weiterhin allein passwort_hash. Dieser Klartext ist
-- eine Merkhilfe, kein Zugang: Wer ihn ändert, ändert nichts an der Anmeldung.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0028 voraus.
-- =============================================================================

alter table public.suppliers
  add column if not exists start_passwort text;

comment on column public.suppliers.start_passwort is
  'Das vergebene Passwort im Klartext, damit wir es nachlesen können. '
  'Vertretbar, weil Lieferanten ihr Passwort nicht selbst wählen. Für die '
  'Anmeldung zählt allein passwort_hash.';

-- Kontrolle: Wer hat ein Passwort, und welches?
--   select name, firma, email, coalesce(start_passwort, '– noch keines –') as passwort
--     from public.suppliers
--    order by firma, name;
