-- =============================================================================
-- Baukoordination – Migration 37: Sammelmail statt Einzelmeldungen
--
-- Ein Lieferant bekam bisher für jede Kleinigkeit eine eigene Mail: drei neue
-- Aufgaben am Vormittag waren drei Mails. Wer so viel Post aus einem Werkzeug
-- bekommt, liest nach zwei Wochen keine davon mehr – und dann ist auch die
-- wichtige nichts mehr wert.
--
-- Neu sammelt die App, was tagsüber geschieht, und schickt am nächsten Morgen
-- um halb acht eine Nachricht mit allem darin.
--
-- Ausgenommen bleiben die Fristerinnerungen und die Mahnung. Die sind an einen
-- Tag gebunden: "heute fällig" in einer Sammelmail von morgen früh wäre falsch.
--
-- Diese Tabelle ist die Warteschlange dazwischen. Sie hält fest, wer was noch
-- zugestellt bekommt; der Prüflauf leert sie und vermerkt den Versand.
--
-- Zugriff ausschliesslich über den Dienstschlüssel: Hier stehen die Adressen
-- aller Beteiligten beieinander. Deshalb RLS ohne Regel.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

create table if not exists public.mail_queue (
  id            uuid primary key default gen_random_uuid(),
  -- Die Zieladresse. Bewusst die Adresse und nicht die Kennung der Person:
  -- Wer später die Firma wechselt, soll nicht plötzlich fremde Post bekommen.
  empfaenger    text not null,
  project_id    uuid references public.projects (id) on delete cascade,
  -- Der Projektname zum Zeitpunkt des Ereignisses – damit die Sammelmail auch
  -- dann noch stimmt, wenn das Projekt inzwischen umbenannt wurde.
  projekt_name  text,
  -- Der fertige Satz, z.B. 'Stive Meier hat To-Do "Kran bestellen" angelegt'.
  text          text not null,
  icon          text,
  created_at    timestamptz not null default now(),
  -- Null = wartet auf die nächste Sammelmail.
  gesendet_am   timestamptz
);

-- Der Prüflauf sucht genau nach dem, was noch wartet.
create index if not exists mail_queue_offen_idx
  on public.mail_queue (empfaenger, created_at)
  where gesendet_am is null;

alter table public.mail_queue enable row level security;

-- Keine Regel, also kein Zugriff ausser über den Dienstschlüssel.

comment on table public.mail_queue is
  'Warteschlange für die morgendliche Sammelmail. Fristerinnerungen und '
  'Mahnungen laufen nicht hierüber – die gehen sofort hinaus.';

-- Kontrolle: Was liegt gerade zur Zustellung bereit?
--   select empfaenger, count(*) as eintraege, min(created_at) as seit
--     from public.mail_queue
--    where gesendet_am is null
--    group by empfaenger
--    order by eintraege desc;
