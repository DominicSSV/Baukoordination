-- =============================================================================
-- Baukoordination – Migration 44: Rechnungsadresse am Projekt
--
-- Wohin die Rechnung geht, stand bisher in Mails und im Kopf. Wer eine Offerte
-- schreibt oder am Monatsende abrechnet, fragt dann nach – und bekommt die
-- Adresse eines anderen Projekts, weil beide demselben Verwalter gehören.
--
-- Neu hängt sie am Projekt und steht im Register "Projektinfos", dort, wo auch
-- Zugang, Standort und die Leute vor Ort stehen.
--
-- Eigene Spalten und keine Zeile in project_infos: Eine Rechnungsadresse hat
-- feste Bestandteile. Als freier Text geschrieben steht bei einem Projekt
-- "c/o Verwaltung" in der Strasse und beim nächsten im Namen, und beim
-- Zusammenzählen am Jahresende stimmt nichts mehr.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

alter table public.projects
  -- Name ODER Firma – auf der Rechnung steht das eine oder das andere, und
  -- welches, entscheidet der Empfänger und nicht die App.
  add column if not exists rechnung_name     text,
  add column if not exists rechnung_strasse  text,
  add column if not exists rechnung_plz      text,
  -- Die Postleitzahl allein genügt nicht; ohne Ort ist keine Adresse
  -- zustellbar. Sie stehen getrennt, damit sich später nach Ort auswerten
  -- lässt, ohne im Text zu suchen.
  add column if not exists rechnung_ort      text,
  -- Wie die Rechnung hinausgeht: per Mail an eine bestimmte Adresse, per Post,
  -- über ein Portal. Bewusst freier Text – jeder Verwalter will es anders, und
  -- eine Auswahlliste wäre nach dem dritten Kunden zu eng.
  add column if not exists rechnung_versand  text;

comment on column public.projects.rechnung_name is
  'Empfänger der Rechnung: Name oder Firma.';
comment on column public.projects.rechnung_versand is
  'Wie die Rechnung zugestellt wird, z.B. "Per Mail an buchhaltung@…" oder '
  '"Per Post an die Verwaltung".';

-- Kontrolle: Wo fehlt die Rechnungsadresse noch?
--   select name,
--          coalesce(rechnung_name, '– fehlt –')    as empfaenger,
--          coalesce(rechnung_strasse, '– fehlt –') as strasse,
--          coalesce(rechnung_plz, '') || ' ' || coalesce(rechnung_ort, '') as ort,
--          coalesce(rechnung_versand, '– fehlt –') as versand
--     from public.projects
--    order by (rechnung_name is null) desc, name;
