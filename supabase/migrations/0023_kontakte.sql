-- =============================================================================
-- Baukoordination – Migration 23: Telefonnummer bei uns selbst
--
-- Die Lieferantenkartei führt seit jeher eine Telefonnummer (suppliers.kontakt).
-- Für unsere eigenen Leute gab es kein solches Feld – im neuen Register
-- "Kontakte" soll aber die ganze Projektmannschaft mit Nummer stehen, damit man
-- auf der Baustelle nicht zwischen App und Adressbuch wechseln muss.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0002 voraus.
-- =============================================================================

alter table public.admins
  add column if not exists kontakt text;

comment on column public.admins.kontakt is
  'Telefonnummer, wie bei den Lieferanten. Sichtbar nur für die Swiss Solar Ventures AG.';

-- Kontrolle:
--   select name, funktion, kontakt from public.admins order by name;
