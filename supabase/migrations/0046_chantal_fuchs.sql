-- =============================================================================
-- Baukoordination – Migration 46: Chantal Fuchs freischalten
--
-- Eine neue Mitarbeiterin bekommt Zugang. Das geschieht in zwei Schritten,
-- und dieses Skript ist der erste:
--
--   1. HIER: Die Adresse kommt auf die Liste der Freigeschalteten.
--   2. DANACH: Das Konto wird in Supabase unter Authentication → Users
--      angelegt (siehe unten).
--
-- Die Reihenfolge ist wichtig, aber nicht heikel: Beim Anlegen des Kontos
-- schaut ein Auslöser in der Datenbank in dieser Liste nach und richtet das
-- Profil ein. Steht die Adresse noch nicht drin, entsteht ein Konto ohne
-- Rechte – Anmelden ja, aber kein einziges Projekt zu sehen. Repariert wird
-- das vom zweiten Teil weiter unten, der bereits bestehende Konten nachträgt.
-- Darum ist die Reihenfolge am Ende gleichgültig: Dieses Skript wirkt in
-- beide Richtungen.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0002 voraus.
-- =============================================================================

-- 1) Auf die Liste der Freigeschalteten -------------------------------------
--
-- Die Adresse ist der Schlüssel. Wer sich später mit einer anderen Adresse
-- anmeldet – auch mit einer Weiterleitung auf dieselbe Person –, ist für die
-- App jemand anderes.
insert into public.admin_seed (email, name, firma, funktion) values
  ('c.fuchs@swiss-sv.ch', 'Chantal Fuchs', 'Swiss Solar Ventures AG', 'Projekt Trainee')
on conflict (email) do update
  set name = excluded.name,
      firma = excluded.firma,
      funktion = excluded.funktion;

-- 2) Falls das Konto schon existiert: Profil nachtragen ----------------------
--
-- Wer das Konto in Supabase anlegt, bevor dieses Skript gelaufen ist, hätte
-- sonst ein Konto ohne Profil. Diese Zeilen holen das nach.
insert into public.admins (user_id, name, email, firma, funktion)
select u.id, s.name, u.email, s.firma, s.funktion
from auth.users u
join public.admin_seed s on lower(s.email) = lower(u.email)
where lower(u.email) = 'c.fuchs@swiss-sv.ch'
on conflict (user_id) do update
  set name = excluded.name,
      firma = excluded.firma,
      funktion = excluded.funktion,
      email = excluded.email;

-- =============================================================================
-- Was danach in Supabase zu tun ist
--
--   Authentication → Users → "Add user" → "Create new user"
--     Email:            c.fuchs@swiss-sv.ch
--     Password:         euer gemeinsames Passwort
--     Auto Confirm User: EINSCHALTEN
--
-- Ohne "Auto Confirm User" wartet das Konto auf eine Bestätigungsmail, die
-- womöglich nie ankommt, und die Anmeldung scheitert mit "Email not
-- confirmed".
--
-- Danach: Projekte zuteilen.
--
-- Ein freigeschalteter Bauherrenvertreter SIEHT alle Projekte – die
-- Zuteilung regelt nicht den Zugang, sondern die Post. Wem kein Projekt
-- zugeteilt ist, bekommt zu keinem Projekt Meldungen, weder per Mail noch
-- in der Glocke (seit Migration 0024). Chantal bleibt also still, bis ihr
-- jemand ein Projekt zuteilt: im Projekt unter "Beteiligte".
-- =============================================================================

-- Kontrolle: Wer ist freigeschaltet, und wer hat schon ein Konto?
--   select s.email,
--          s.name,
--          s.funktion,
--          case when u.id is null then 'Konto fehlt noch'
--               when a.user_id is null then 'Konto da, aber kein Profil'
--               else 'bereit' end as stand
--     from public.admin_seed s
--     left join auth.users u on lower(u.email) = lower(s.email)
--     left join public.admins a on a.user_id = u.id
--    order by s.email;
