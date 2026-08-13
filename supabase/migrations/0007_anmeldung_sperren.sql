-- =============================================================================
-- Baukoordination – Erweiterung 7: Anmeldung vorübergehend sperren
--
-- Ein gesperrter Bauherrenvertreter behält Konto, Profil, Bild und alle ihm
-- zugewiesenen Aufgaben – er kommt nur nicht mehr hinein. Das ist gedacht für
-- Umbauphasen, in denen niemand sonst in der App arbeiten soll.
--
-- Im Supabase SQL-Editor ausführen. Idempotent.
-- =============================================================================

alter table public.admins
  add column if not exists aktiv boolean not null default true;

-- -----------------------------------------------------------------------------
-- Anmeldung sperren
-- -----------------------------------------------------------------------------
update public.admins
set aktiv = false
where lower(email) in (
  'm.maerki@swiss-sv.ch',
  'v.gantner@swiss-sv.ch'
);

-- -----------------------------------------------------------------------------
-- Zum Wiederfreischalten später diesen Befehl ausführen:
--
--   update public.admins
--   set aktiv = true
--   where lower(email) in ('m.maerki@swiss-sv.ch', 'v.gantner@swiss-sv.ch');
--
-- Kontrolle, wer angemeldet werden darf:
--
--   select email, aktiv from public.admins order by email;
-- -----------------------------------------------------------------------------

select email, name, aktiv from public.admins order by email;
