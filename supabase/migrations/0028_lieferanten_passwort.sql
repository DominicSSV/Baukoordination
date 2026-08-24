-- =============================================================================
-- Baukoordination – Migration 28: Anmeldung mit E-Mail und Passwort
--
-- Bisher meldeten sich Lieferanten nur mit einem Zugangscode an. Das Feld war
-- ein gewöhnliches Textfeld, und kein Browser bietet an, so etwas zu
-- speichern – auf der Baustelle hiess das: bei jedem Öffnen den Code aus der
-- alten E-Mail heraussuchen. Nach dem zweiten Mal macht das niemand mehr.
--
-- Neu darf jede Person zusätzlich ein Passwort setzen. Dann greift die
-- Passwortverwaltung des Handys wie bei jeder anderen Anmeldung.
--
-- Der Zugangscode bleibt bestehen und funktioniert weiter: Er ist der Weg
-- hinein, bevor es ein Passwort gibt, und die Rettung, wenn jemand es
-- vergisst. Bereits verschickte Einladungen bleiben damit gültig.
--
-- Gespeichert wird nie das Passwort selbst, sondern nur ein Prüfwert daraus
-- (scrypt mit eigenem Zufallssalz je Person). Aus dem Prüfwert lässt sich das
-- Passwort nicht zurückrechnen; wer die Tabelle liest, kann sich damit nicht
-- anmelden.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

alter table public.suppliers
  add column if not exists passwort_hash text;

alter table public.suppliers
  add column if not exists passwort_gesetzt_am timestamptz;

comment on column public.suppliers.passwort_hash is
  'Prüfwert des Passworts (scrypt, mit Salz). Nie das Passwort selbst.';

comment on column public.suppliers.passwort_gesetzt_am is
  'Wann zuletzt ein Passwort gesetzt wurde. Leer = es gibt keines, '
  'die Anmeldung läuft über den Zugangscode.';

-- Die Anmeldung sucht über die Mailadresse. Ein Index macht das schnell und
-- macht zugleich sichtbar, wenn eine Adresse doppelt vorkommt.
create index if not exists suppliers_email_idx
  on public.suppliers (lower(email))
  where email is not null;

-- ---------------------------------------------------------------------------
-- Vor dem Freischalten prüfen: Kommt eine Adresse mehrfach vor, weiss die
-- Anmeldung nicht, wer gemeint ist. Die App verweigert in dem Fall den Zugang
-- und verlangt eine Rückfrage bei euch – besser als die falsche Person
-- anzumelden. Am besten also vorher bereinigen.
--
--   select lower(email) as adresse, count(*)
--     from public.suppliers
--    where email is not null and btrim(email) <> ''
--    group by 1
--   having count(*) > 1;
--
-- Wer schon ein Passwort hat:
--   select name, firma, email, passwort_gesetzt_am
--     from public.suppliers
--    order by passwort_gesetzt_am desc nulls last;
--
-- Passwort einer Person zurücksetzen (sie meldet sich danach wieder mit dem
-- Zugangscode an und kann ein neues setzen):
--   update public.suppliers
--      set passwort_hash = null, passwort_gesetzt_am = null
--    where email = 'adresse@firma.ch';
-- ---------------------------------------------------------------------------
