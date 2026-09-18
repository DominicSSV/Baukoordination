-- =============================================================================
-- Baukoordination – Migration 38: Benachrichtigungen vorübergehend abstellen
--
-- Wer ein Projekt aufräumt, legt in zehn Minuten fünfzehn Aufgaben an, hakt
-- alte ab und schiebt Termine. Bisher ging über jeden dieser Handgriffe eine
-- Meldung hinaus. Am Ende hatten alle Beteiligten ein volles Postfach über
-- Arbeit, die niemanden ausser dem Aufräumenden betraf.
--
-- Neu lässt sich die Benachrichtigung je Projekt vorübergehend abstellen. Was
-- in dieser Zeit geschieht, wird weiterhin vollständig protokolliert – nur
-- meldet es sich bei niemandem.
--
-- Der Punkt beim Wiedereinschalten: Es wird nichts nachgeholt. Die stillen
-- Einträge bleiben still, für immer. Alles davor und alles danach meldet sich
-- wie gewohnt. Eine Nachholmeldung wäre genau das, was man vermeiden wollte.
--
-- Im Supabase SQL-Editor ausführen. Mehrfaches Ausführen ist unschädlich.
-- Setzt Migration 0001 voraus.
-- =============================================================================

-- 1) Der Vermerk am Protokolleintrag ------------------------------------------
--
-- Bewusst am Eintrag und nicht an einem Zeitraum: Ein Zeitraum müsste beim
-- Lesen jedes Mal nachgerechnet werden, und verschiebt jemand später die
-- Uhrzeit, kämen alte Einträge plötzlich wieder zum Vorschein. Der Vermerk
-- steht fest, sobald der Eintrag geschrieben ist.
alter table public.activity
  add column if not exists leise boolean not null default false;

comment on column public.activity.leise is
  'true = geschrieben, während die Benachrichtigungen abgestellt waren. '
  'Steht im Protokoll, taucht aber in keiner Glocke auf und hat nie eine '
  'Mail ausgelöst.';

-- Die Glocke fragt nach allem, was nicht leise ist – und zwar oft.
create index if not exists activity_laut_idx
  on public.activity (project_id, created_at desc)
  where leise = false;

-- 2) Wer gerade still geschaltet hat ------------------------------------------
--
-- Je Person und Projekt eine Zeile. Die Stille gehört der Person: Wenn Dominic
-- ein Projekt aufräumt, sollen seine Handgriffe still bleiben – nicht die von
-- Maurice, der zur selben Zeit am selben Projekt etwas Wichtiges einträgt.
create table if not exists public.notify_pause (
  user_id    uuid not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Seit wann. Nur zur Anzeige: "seit 14:20 abgestellt" erinnert daran, dass
  -- man es wieder einschalten wollte.
  seit       timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.notify_pause enable row level security;

-- Keine Regel, also kein Zugriff ausser über den Dienstschlüssel. Die App
-- prüft vorher, dass nur wir von der Swiss Solar Ventures AG umschalten
-- dürfen – ein Lieferant könnte sonst seine eigenen Änderungen verstecken.

comment on table public.notify_pause is
  'Wer bei welchem Projekt die Benachrichtigungen gerade abgestellt hat. '
  'Zeile vorhanden = abgestellt. Beim Einschalten wird sie gelöscht und '
  'nichts nachgeholt.';

-- Kontrolle: Wo ist es gerade still?
--   select a.name, p.name as projekt, np.seit
--     from public.notify_pause np
--     join public.projects p on p.id = np.project_id
--     left join public.admins a on a.user_id = np.user_id
--    order by np.seit;

-- Kontrolle: Wie viele Einträge sind still entstanden?
--   select p.name, count(*) as leise_eintraege
--     from public.activity ac
--     join public.projects p on p.id = ac.project_id
--    where ac.leise
--    group by p.name
--    order by leise_eintraege desc;
