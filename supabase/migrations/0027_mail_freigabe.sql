-- =============================================================================
-- Baukoordination – Migration 27: Wer ausserhalb der Firma Post bekommt
--
-- Bisher entschied allein die Mail-Domain: Alles auf @swiss-sv.ch bekam Post,
-- alles andere nicht. Das war für den Anfang richtig – niemand sollte
-- ungefragt Mail von einer App bekommen, die gerade erst aufgebaut wird.
--
-- Jetzt sollen einzelne Lieferanten dazukommen, aber nicht alle auf einmal.
-- Eine Domain kann das nicht unterscheiden, also braucht es eine Freigabe je
-- Person. Standard ist "nein": Wer neu angelegt wird, bekommt weiterhin keine
-- Post, bis jemand es ausdrücklich einschaltet.
--
-- Die Freigabe steuert ausschliesslich den Mailversand. Was jemand sieht,
-- regeln weiterhin die Projektfreigaben und die RLS-Regeln; hier ändert sich
-- daran bewusst nichts.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

alter table public.suppliers
  add column if not exists mail_an boolean not null default false;

comment on column public.suppliers.mail_an is
  'Bekommt diese Person automatische Benachrichtigungen per Mail? '
  'Standard nein. Steuert nur den Versand, kein Zugriffsrecht.';

-- ---------------------------------------------------------------------------
-- Einmalig: Stive Meier freischalten.
--
-- Gesucht wird über den Namen, weil die Kennung hier nicht bekannt ist. Prüfe
-- mit der Kontrollabfrage unten, ob genau eine Zeile getroffen wurde – bei
-- mehreren Treffern lieber die Bedingung auf die Mailadresse umstellen.
--
-- Danach geht dasselbe jederzeit in der App: Kontakte öffnen, bei der Person
-- auf Bearbeiten, Haken bei "Bekommt Benachrichtigungen per Mail".
-- ---------------------------------------------------------------------------

update public.suppliers
   set mail_an = true
 where name ilike '%stive%'
    or name ilike '%meier%';

-- Kontrolle: Hier muss Stive Meier stehen – und sonst niemand.
--   select name, firma, email, mail_an
--     from public.suppliers
--    order by mail_an desc, firma, name;
--
-- Zu viel freigeschaltet? Einzeln zurücknehmen:
--   update public.suppliers set mail_an = false where name = 'Name der Person';
