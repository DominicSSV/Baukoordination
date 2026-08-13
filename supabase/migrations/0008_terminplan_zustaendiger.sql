-- =============================================================================
-- Baukoordination – Erweiterung 8: Zuständige Person im Terminplan
--
-- Bisher stand links nur das Gewerk als Text ("Gärtner", "Kran"). Neu kommt die
-- Person dazu, die es organisiert hat – ihr Profilbild steht ganz links in der
-- Zeile. Das kann jemand der Swiss Solar Ventures AG oder ein Lieferant sein.
--
-- Im Supabase SQL-Editor ausführen. Idempotent.
-- =============================================================================

-- Gleiches Schema wie bei den To-Dos: 'admin:<user_id>' oder 'supplier:<id>'.
-- Leer bedeutet: niemand zugeordnet, dann bleibt der Platz links frei.
alter table public.schedule_tasks
  add column if not exists owner text;
