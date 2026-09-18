-- =============================================================================
-- Baukoordination – Migration 36: Daumen hoch auf Kommentare
--
-- Auf der Baustelle braucht es oft keine Antwort, sondern nur ein Zeichen:
-- gesehen, einverstanden, macht so. Wer dafür "ok" schreiben muss, schreibt es
-- nicht – und der Fragende wartet weiter.
--
-- Bewusst nur der Daumen und keine Auswahl an Zeichen. Ein zweites Zeichen
-- wirft sofort die Frage auf, was es bedeutet; ein Daumen bedeutet überall
-- dasselbe.
--
-- Eigene Tabelle statt einer Spalte an den Kommentaren: Ein Daumen gehört einer
-- Person, und zwei Leute dürfen nicht gleichzeitig dieselbe Zeile überschreiben.
-- So hält die Datenbank selbst fest, dass jede Person je Kommentar höchstens
-- einen Daumen hat.
--
-- Zugriff läuft ausschliesslich über den Dienstschlüssel: Die Routen prüfen
-- vorher, ob die Person den Kommentar überhaupt sehen darf. Deshalb steht hier
-- RLS ohne Regel – damit kommt niemand sonst an die Tabelle heran.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

create table if not exists public.comment_kudos (
  id          uuid primary key default gen_random_uuid(),
  -- Auf welchen Kommentar: 'todo' = todo_comments, 'datei' = file_comments.
  -- Bewusst ohne Fremdschlüssel, weil zwei Tabellen in Frage kommen; dafür
  -- räumt die App beim Löschen eines Kommentars selbst auf.
  comment_id  uuid not null,
  art         text not null check (art in ('todo', 'datei')),
  -- Wer, in derselben Schreibweise wie bei den Zuständigen:
  -- 'admin:<user_id>' oder 'supplier:<id>'.
  wer         text not null,
  -- Der Name zum Zeitpunkt des Klicks – damit die Anzeige ohne zweite Abfrage
  -- auskommt und auch dann noch stimmt, wenn jemand die Firma wechselt.
  name        text not null,
  created_at  timestamptz not null default now(),
  -- Jede Person höchstens einen Daumen je Kommentar. Ein zweiter Klick nimmt
  -- ihn zurück, statt einen weiteren anzulegen.
  unique (comment_id, art, wer)
);

create index if not exists comment_kudos_idx
  on public.comment_kudos (art, comment_id);

alter table public.comment_kudos enable row level security;

-- Keine Regel, also kein Zugriff ausser über den Dienstschlüssel. Siehe oben:
-- Ob jemand den Kommentar sehen darf, ist beim Kommentar selbst geregelt und
-- wird in den Routen geprüft.

comment on table public.comment_kudos is
  'Daumen hoch auf einen Kommentar. Zugriff nur über den Dienstschlüssel; '
  'die Routen prüfen vorher den Zugriff auf das Projekt.';

-- Kontrolle: Wer hat wo zugestimmt?
--   select art, comment_id, name, created_at
--     from public.comment_kudos
--    order by created_at desc
--    limit 20;
