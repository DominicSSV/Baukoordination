-- =============================================================================
-- Baukoordination – Migration 49: Neuer Firmenname
--
-- Aus der Swiss Solar Ventures AG ist die Swiss Sustainable Ventures AG
-- geworden. In der App steht der Name an einer Stelle im Programmcode – der
-- ist mit dieser Fassung geändert. In der Datenbank steht er aber auch, und
-- zwar dort, wo er einmal abgeschrieben wurde: in den Profilen und in den
-- Nachrichtenvorlagen.
--
-- Was dieses Skript NICHT anfasst, und warum:
--
--   Das Protokoll (activity). Dort steht, was damals geschehen ist. Ein
--   Eintrag von letztem Jahr, der rückwirkend den heutigen Firmennamen trägt,
--   behauptet etwas, das so nicht war. Geschichte wird nicht umbenannt.
--
--   Die Rechnungsadressen der Projekte. Dort steht, an wen die Rechnung geht –
--   das ist in aller Regel der Eigentümer der Liegenschaft und nicht wir.
--   Steht dort doch einmal unser alter Name, ändert ihn besser jemand von
--   Hand, der weiss, ob er gemeint war. Unten steht ein Befehl dafür, bewusst
--   auskommentiert.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- =============================================================================

-- 1) Die Liste der Freigeschalteten -------------------------------------------
update public.admin_seed
   set firma = 'Swiss Sustainable Ventures AG'
 where firma = 'Swiss Solar Ventures AG';

-- 2) Unsere Profile ------------------------------------------------------------
update public.admins
   set firma = 'Swiss Sustainable Ventures AG'
 where firma = 'Swiss Solar Ventures AG';

-- 3) Lieferanten, die auf uns selbst zeigen -------------------------------------
--
-- Kommt vor: Wer sich selbst einmal als Firma angelegt hat, um etwas
-- auszuprobieren, steht dort mit dem alten Namen.
update public.suppliers
   set firma = 'Swiss Sustainable Ventures AG'
 where firma = 'Swiss Solar Ventures AG';

-- 4) Kontakte vor Ort ------------------------------------------------------------
update public.project_contacts
   set firma = 'Swiss Sustainable Ventures AG'
 where firma = 'Swiss Solar Ventures AG';

-- 5) Die Nachrichtenvorlagen ------------------------------------------------------
--
-- Darin steht, was in unserem Namen hinausgeht. Ein Text, der die Firma noch
-- beim alten Namen nennt, geht an Lieferanten – und zwar jeden Tag.
update public.mail_templates
   set betreff = replace(betreff, 'Swiss Solar Ventures', 'Swiss Sustainable Ventures'),
       text    = replace(text,    'Swiss Solar Ventures', 'Swiss Sustainable Ventures')
 where betreff like '%Swiss Solar Ventures%'
    or text    like '%Swiss Solar Ventures%';

-- 6) Angaben zum Objekt -----------------------------------------------------------
--
-- Freitext, den wir selbst geschrieben haben. Hier ist ein Ersetzen
-- unbedenklich: Was dort steht, stammt von uns.
update public.project_infos
   set text = replace(text, 'Swiss Solar Ventures', 'Swiss Sustainable Ventures')
 where text like '%Swiss Solar Ventures%';

-- --- Von Hand, falls nötig ----------------------------------------------------
-- Rechnungsadressen, die auf uns lauten – erst nachsehen, dann ausführen:
--
--   select name, rechnung_name from public.projects
--    where rechnung_name like '%Swiss Solar Ventures%';
--
--   update public.projects
--      set rechnung_name = replace(rechnung_name, 'Swiss Solar Ventures', 'Swiss Sustainable Ventures')
--    where rechnung_name like '%Swiss Solar Ventures%';

-- Kontrolle: Steht irgendwo noch der alte Name?
--   select 'admins' as tabelle, count(*) from public.admins where firma like '%Swiss Solar%'
--   union all select 'admin_seed', count(*) from public.admin_seed where firma like '%Swiss Solar%'
--   union all select 'suppliers', count(*) from public.suppliers where firma like '%Swiss Solar%'
--   union all select 'kontakte', count(*) from public.project_contacts where firma like '%Swiss Solar%'
--   union all select 'vorlagen', count(*) from public.mail_templates
--             where betreff like '%Swiss Solar%' or text like '%Swiss Solar%';
