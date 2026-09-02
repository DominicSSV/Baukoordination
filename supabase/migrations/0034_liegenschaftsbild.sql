-- =============================================================================
-- Baukoordination – Migration 34: Bild der Liegenschaft
--
-- Ein Foto sagt mehr über eine Baustelle als drei Zeilen Adresse: Flachdach
-- oder Schrägdach, Gerüst nötig oder nicht, wo der Lieferwagen hinkommt. Wer
-- zum ersten Mal hinfährt, erkennt am Bild, ob er richtig ist.
--
-- Gespeichert wird nur der Pfad. Das Bild selbst liegt im Ablageort "avatars"
-- unter projekte/<id>/. Bewusst kein eigener Ablageort: Der bestehende ist
-- privat, wird ausschliesslich über kurzlebige Signaturen gelesen und über den
-- Dienstschlüssel beschrieben – genau das, was hier gebraucht wird. Ein zweiter
-- wäre eine weitere Sache, die von Hand einzurichten und richtig zu schützen
-- wäre, ohne dass sich etwas daran unterschiede.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0005 voraus (dort entsteht der Ablageort "avatars").
-- =============================================================================

alter table public.projects
  add column if not exists bild_path text;

comment on column public.projects.bild_path is
  'Pfad des Liegenschaftsbildes im Ablageort "avatars" (projekte/<id>/...). '
  'Gelesen wird es nur über kurzlebige Signaturen, nie öffentlich.';

-- Kontrolle: Welche Projekte haben ein Bild?
--   select name, coalesce(bild_path, '– keines –') as bild
--     from public.projects
--    order by name;
