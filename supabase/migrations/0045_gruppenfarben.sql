-- =============================================================================
-- Baukoordination – Migration 45: Farbe je Projektgruppe
--
-- Die Seitenleiste gliedert nach Sparte: Photovoltaik, BESS, Abrechnung,
-- Heizung, Sanierungen. Gegliedert ist sie damit, unterscheidbar noch nicht –
-- beim Überfliegen sehen alle Überschriften gleich aus, und man liest jede,
-- statt die gesuchte zu finden.
--
-- Neu hat jede Sparte eine Farbe. Sie erscheint als Punkt neben dem Namen und
-- als feiner Strich an der linken Kante des Blocks, sodass man auf einen Blick
-- sieht, wo eine Sparte anfängt und wo die nächste.
--
-- Die Farbe ist wählbar und nicht aus dem Namen errechnet: Photovoltaik ist
-- gelb, weil Sonne gelb ist, und nicht, weil die Buchstabensumme zufällig auf
-- Gelb fällt. Wer eine Sparte umbenennt, soll ausserdem nicht plötzlich eine
-- andere Farbe bekommen.
--
-- Fehlt diese Migration, leitet die App die Farbe aus dem Namen ab. Die
-- Gliederung funktioniert also auch ohne – nur nicht nach Wunsch.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich:
-- Eine bereits gesetzte Farbe wird nicht überschrieben.
-- Setzt Migration 0043 voraus.
-- =============================================================================

alter table public.project_groups
  add column if not exists farbe text;

comment on column public.project_groups.farbe is
  'Farbe der Sparte in der Seitenleiste, als #RRGGBB. Null = die App leitet '
  'eine aus dem Namen ab.';

-- Vorschlag für die bestehenden Sparten. Nur dort, wo noch keine Farbe steht –
-- eine von Hand gewählte bleibt bei einem erneuten Durchlauf erhalten.
--
-- Die Zuordnung ist nicht willkürlich: Gelb für die Sonne, Blau für den
-- Speicher, Grau für die Abrechnung (Papier), Rot für die Heizung, Grün für
-- Sanierungen.
update public.project_groups set farbe = '#FFC000'
 where farbe is null and (name ilike '%photovolt%' or name ilike 'pva%');

update public.project_groups set farbe = '#00B0F0'
 where farbe is null and name ilike '%bess%';

update public.project_groups set farbe = '#929291'
 where farbe is null and (name ilike '%abrechnung%' or name ilike '%abrechnungsmodell%');

update public.project_groups set farbe = '#C00000'
 where farbe is null and name ilike '%heizung%';

update public.project_groups set farbe = '#00BF63'
 where farbe is null and name ilike '%sanierung%';

-- Kontrolle: Welche Sparte hat welche Farbe?
--   select name, coalesce(farbe, '– aus dem Namen abgeleitet –') as farbe,
--          order_index
--     from public.project_groups
--    order by order_index;
